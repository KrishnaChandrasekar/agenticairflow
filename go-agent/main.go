package main

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

type JobStatus string

const (
	StatusPending   JobStatus = "PENDING"
	StatusRunning   JobStatus = "RUNNING"
	StatusSucceeded JobStatus = "SUCCEEDED"
	StatusFailed    JobStatus = "FAILED"
)

type Job struct {
	ID        string            `json:"job_id"`
	Command   string            `json:"command"`
	Cwd       string            `json:"cwd"`
	RunAs     string            `json:"run_as,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Timeout   int               `json:"timeout_seconds,omitempty"`
	Status    JobStatus         `json:"status"`
	PID       int               `json:"pid,omitempty"`
	RC        int               `json:"rc,omitempty"`
	LogPath   string            `json:"log_path"`
	CreatedAt time.Time         `json:"created_at"`
	UpdatedAt time.Time         `json:"updated_at"`
}

var (
	jobs   = make(map[string]*Job)
	jobsMu sync.Mutex
)

// Secure registration functions
func generatePrivateKey() (*rsa.PrivateKey, error) {
	return rsa.GenerateKey(rand.Reader, 2048)
}

func generateCSR(privateKey *rsa.PrivateKey, agentID string) (string, error) {
	template := x509.CertificateRequest{
		Subject: pkix.Name{
			CommonName:   agentID,
			Organization: []string{"Agentic Agent"},
		},
		DNSNames: []string{agentID},
	}

	csrBytes, err := x509.CreateCertificateRequest(rand.Reader, &template, privateKey)
	if err != nil {
		return "", err
	}

	csrPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE REQUEST",
		Bytes: csrBytes,
	})

	return string(csrPEM), nil
}

func saveCertificate(certificatePEM string, privateKey *rsa.PrivateKey, agentHome string) error {
	certPath := filepath.Join(filepath.Dir(agentHome), "agent.crt")
	keyPath := filepath.Join(filepath.Dir(agentHome), "agent.key")

	// Save certificate
	err := ioutil.WriteFile(certPath, []byte(certificatePEM), 0600)
	if err != nil {
		return err
	}

	// Save private key
	keyBytes, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return err
	}

	keyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: keyBytes,
	})

	err = ioutil.WriteFile(keyPath, keyPEM, 0600)
	if err != nil {
		return err
	}

	fmt.Printf("[go-agent] Certificate saved to %s\n", certPath)
	fmt.Printf("[go-agent] Private key saved to %s\n", keyPath)
	return nil
}

func loadCertificate(agentHome string) (string, error) {
	certPath := filepath.Join(filepath.Dir(agentHome), "agent.crt")
	certBytes, err := ioutil.ReadFile(certPath)
	if err != nil {
		return "", err
	}
	return string(certBytes), nil
}

func isCertificateValid(agentHome string) bool {
	certPEM, err := loadCertificate(agentHome)
	if err != nil {
		return false
	}

	block, _ := pem.Decode([]byte(certPEM))
	if block == nil {
		return false
	}

	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return false
	}

	// Check if certificate is still valid (not expired)
	return time.Now().Before(cert.NotAfter)
}

func secureRegister(agentID, agentName, selfURL, agentLabels, routerURL, agentHome string) bool {
	fmt.Printf("[go-agent] Starting secure registration for agent %s\n", agentID)

	// Check if we already have a valid certificate
	if isCertificateValid(agentHome) {
		fmt.Println("[go-agent] Valid certificate already exists, skipping registration")
		return true
	}

	fmt.Println("[go-agent] No valid certificate found, proceeding with registration")

	// Step 1: Announce to router
	announceBody := map[string]interface{}{
		"agent_id": agentID,
		"name":     agentName,
		"url":      selfURL,
		"labels":   parseLabels(agentLabels),
	}

	fmt.Println("[go-agent] Announcing to router...")
	client := &http.Client{Timeout: 10 * time.Second}
	announceBytes, _ := json.Marshal(announceBody)
	req, err := http.NewRequest("POST", routerURL+"/agents/announce", bytes.NewBuffer(announceBytes))
	if err != nil {
		fmt.Printf("[go-agent] Announce request creation failed: %v\n", err)
		return false
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("[go-agent] Announce request failed: %v\n", err)
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := ioutil.ReadAll(resp.Body)
		fmt.Printf("[go-agent] Announce failed: %d %s\n", resp.StatusCode, string(respBody))
		return false
	}

	var announceResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&announceResp); err != nil {
		fmt.Printf("[go-agent] Failed to decode announce response: %v\n", err)
		return false
	}

	otp, ok := announceResp["otp"].(string)
	if !ok || otp == "" {
		fmt.Println("[go-agent] No OTP received from announce")
		return false
	}

	state, _ := announceResp["state"].(string)
	fmt.Printf("[go-agent] Received OTP, state: %s\n", state)

	// Step 2: Generate private key and CSR
	fmt.Println("[go-agent] Generating private key and CSR...")
	privateKey, err := generatePrivateKey()
	if err != nil {
		fmt.Printf("[go-agent] Private key generation failed: %v\n", err)
		return false
	}

	csrPEM, err := generateCSR(privateKey, agentID)
	if err != nil {
		fmt.Printf("[go-agent] CSR generation failed: %v\n", err)
		return false
	}

	// Step 3: Enroll with OTP and CSR
	enrollBody := map[string]interface{}{
		"agent_id": agentID,
		"otp":      otp,
		"csr":      csrPEM,
	}

	fmt.Println("[go-agent] Enrolling with CSR...")
	enrollBytes, _ := json.Marshal(enrollBody)
	req, err = http.NewRequest("POST", routerURL+"/agents/enroll", bytes.NewBuffer(enrollBytes))
	if err != nil {
		fmt.Printf("[go-agent] Enroll request creation failed: %v\n", err)
		return false
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err = client.Do(req)
	if err != nil {
		fmt.Printf("[go-agent] Enroll request failed: %v\n", err)
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := ioutil.ReadAll(resp.Body)
		fmt.Printf("[go-agent] Enroll failed: %d %s\n", resp.StatusCode, string(respBody))
		return false
	}

	var enrollResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&enrollResp); err != nil {
		fmt.Printf("[go-agent] Failed to decode enroll response: %v\n", err)
		return false
	}

	certificate, ok := enrollResp["certificate"].(string)
	if !ok || certificate == "" {
		fmt.Println("[go-agent] No certificate received from enroll")
		return false
	}

	// Step 4: Save certificate and private key
	if err := saveCertificate(certificate, privateKey, agentHome); err != nil {
		fmt.Printf("[go-agent] Failed to save certificate: %v\n", err)
		return false
	}

	state, _ = enrollResp["state"].(string)
	fmt.Printf("[go-agent] Enrolled successfully, state: %s\n", state)
	return true
}

func getEnv(key, def string) string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v
}

func getEnvInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	i, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return i
}

func getEnvBool(key string, def bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	switch v {
	case "1", "true", "yes", "True", "TRUE":
		return true
	case "0", "false", "no", "False", "FALSE":
		return false
	}
	return def
}

func main() {
	agentHome := getEnv("AGENT_HOME", "/app/agent_jobs")
	agentToken := getEnv("AGENT_TOKEN", "agent-secret")
	routerURL := getEnv("ROUTER_URL", "http://router:8000")
	agentID := getEnv("AGENT_ID", "go_vm1")
	selfURL := getEnv("SELF_URL", "http://go_agent_vm1:8001")
	heartbeatSeconds := getEnvInt("AGENT_HEARTBEAT_SECONDS", 10)
	agentLabels := getEnv("AGENT_LABELS", "{\"os\":\"linux\",\"zone\":\"go\"}")

	os.MkdirAll(agentHome, 0755)

	fmt.Printf("[go-agent] Starting with config: agentID=%s, routerURL=%s, selfURL=%s\n", agentID, routerURL, selfURL)

	// --- Enhanced Reconciliation logic: scan job dirs and report to router with timing data ---
	go func() {
		fmt.Printf("[go-agent] Starting reconciliation for agent %s\n", agentID)
		jobs := []map[string]interface{}{}
		entries, err := os.ReadDir(agentHome)
		if err == nil {
			for _, entry := range entries {
				if !entry.IsDir() {
					continue
				}
				jobID := entry.Name()
				jobDir := filepath.Join(agentHome, jobID)
				pidPath := filepath.Join(jobDir, "pid")
				rcPath := filepath.Join(jobDir, "rc")
				startedAtPath := filepath.Join(jobDir, "started_at")
				finishedAtPath := filepath.Join(jobDir, "finished_at")
				status := "UNKNOWN"
				var pid *int = nil
				var rc *int = nil
				var startedAt *int64 = nil
				var finishedAt *int64 = nil

				// Read pid
				if b, err := os.ReadFile(pidPath); err == nil {
					if p, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil {
						pid = &p
					}
				}

				// Read timing files - CRITICAL: preserve actual job timing
				if b, err := os.ReadFile(startedAtPath); err == nil {
					if t, err := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64); err == nil {
						startedAt = &t
						fmt.Printf("[go-agent] Reconcile: Job %s started_at=%d\n", jobID, *startedAt)
					}
				}
				if b, err := os.ReadFile(finishedAtPath); err == nil {
					if t, err := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64); err == nil {
						finishedAt = &t
						fmt.Printf("[go-agent] Reconcile: Job %s finished_at=%d\n", jobID, *finishedAt)
					}
				}

				// Check if process is alive for running jobs
				alive := false
				if pid != nil && *pid > 0 {
					proc, err := os.FindProcess(*pid)
					if err == nil {
						if err := proc.Signal(syscall.Signal(0)); err == nil {
							alive = true
						}
					}
				}

				// Determine status with improved logic
				if alive {
					status = "RUNNING"
					fmt.Printf("[go-agent] Reconcile: Job %s is RUNNING (PID=%d)\n", jobID, *pid)
				} else if b, err := os.ReadFile(rcPath); err == nil {
					// Job has completed, read return code
					if r, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil {
						rc = &r
						if r == 0 {
							status = "SUCCEEDED"
						} else {
							status = "FAILED"
						}
						fmt.Printf("[go-agent] Reconcile: Job %s completed with status=%s rc=%d\n", jobID, status, r)
					} else {
						rcVal := 1
						rc = &rcVal
						status = "FAILED"
						fmt.Printf("[go-agent] Reconcile: Job %s failed to parse rc, marking as FAILED\n", jobID)
					}
				} else if pid != nil {
					// Has PID but no RC and not alive - orphaned job
					status = "FAILED"
					rcVal := 130 // Process terminated by signal
					rc = &rcVal
					fmt.Printf("[go-agent] Reconcile: Job %s orphaned (PID=%d but not alive), marking as FAILED\n", jobID, *pid)

					// Write missing rc file to prevent future confusion
					os.WriteFile(rcPath, []byte("130"), 0644)
					if finishedAt == nil {
						// Set finished_at to current time if missing
						currentTime := time.Now().Unix()
						finishedAt = &currentTime
						os.WriteFile(finishedAtPath, []byte(strconv.FormatInt(currentTime, 10)), 0644)
					}
				}

				jobData := map[string]interface{}{
					"job_id": jobID,
					"status": status,
					"pid": func() interface{} {
						if pid != nil {
							return *pid
						}
						return nil
					}(),
					"rc": func() interface{} {
						if rc != nil {
							return *rc
						}
						return nil
					}(),
					"started_at": func() interface{} {
						if startedAt != nil {
							return *startedAt
						}
						return nil
					}(),
					"finished_at": func() interface{} {
						if finishedAt != nil {
							return *finishedAt
						}
						return nil
					}(),
				}
				jobs = append(jobs, jobData)
			}
		}

		if len(jobs) > 0 {
			fmt.Printf("[go-agent] Reconciling %d jobs to router\n", len(jobs))
			payload := map[string]interface{}{
				"agent_id": agentID,
				"jobs":     jobs,
			}
			b, _ := json.Marshal(payload)
			req, err := http.NewRequest("POST", routerURL+"/agents/reconcile", bytes.NewBuffer(b))
			if err == nil {
				req.Header.Set("X-Agent-Token", agentToken)
				req.Header.Set("Content-Type", "application/json")
				client := &http.Client{Timeout: 10 * time.Second}
				resp, err := client.Do(req)
				if err == nil {
					defer resp.Body.Close()
					fmt.Printf("[go-agent] Reconciliation response: %d\n", resp.StatusCode)
				} else {
					fmt.Printf("[go-agent] Reconciliation request failed: %v\n", err)
				}
			} else {
				fmt.Printf("[go-agent] Reconciliation request creation failed: %v\n", err)
			}
		} else {
			fmt.Printf("[go-agent] No jobs to reconcile\n")
		}
	}()

	// Always attempt secure registration first, then start heartbeat
	fmt.Printf("[go-agent] Starting registration goroutine for agent %s\n", agentID)
	go autoRegisterForever(agentID, selfURL, agentLabels, agentToken, routerURL, agentHome)
	fmt.Printf("[go-agent] Starting heartbeat goroutine for agent %s\n", agentID)
	go heartbeatLoop(agentID, selfURL, agentToken, routerURL, heartbeatSeconds)

	r := gin.Default()

	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"ok": true, "home": agentHome})
	})

	r.POST("/run", func(c *gin.Context) {
		if c.GetHeader("X-Agent-Token") != agentToken {
			c.JSON(401, gin.H{"error": "unauthorized"})
			return
		}
		var req struct {
			JobID   string                 `json:"job_id"`
			Payload map[string]interface{} `json:"payload"`
		}
		if err := c.BindJSON(&req); err != nil || req.JobID == "" {
			c.JSON(400, gin.H{"error": "job_id required"})
			return
		}
		payload := req.Payload

		cmdVal, ok := payload["command"]
		if !ok || cmdVal == nil {
			c.JSON(400, gin.H{"error": "command required"})
			return
		}
		cmd, ok := cmdVal.(string)
		if !ok {
			c.JSON(400, gin.H{"error": "command must be a string"})
			return
		}

		cwd := ""
		if cwdVal, ok := payload["cwd"]; ok && cwdVal != nil {
			cwd, _ = cwdVal.(string)
		}

		timeout := 0 // No timeout by default
		if tVal, ok := payload["timeout_seconds"]; ok && tVal != nil {
			switch v := tVal.(type) {
			case float64:
				timeout = int(v)
			case int:
				timeout = v
			}
		}

		logPath := filepath.Join(agentHome, req.JobID, "run.log")
		os.MkdirAll(filepath.Dir(logPath), 0755)

		job := &Job{
			ID:        req.JobID,
			Command:   cmd,
			Cwd:       cwd,
			Status:    StatusPending,
			LogPath:   logPath,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		jobsMu.Lock()
		jobs[job.ID] = job
		// ...removed debug log...
		jobsMu.Unlock()

		go runJob(job, timeout)
		c.JSON(200, gin.H{"ok": true, "log_path": logPath})
	})

	r.GET("/status/:job_id", func(c *gin.Context) {
		if c.GetHeader("X-Agent-Token") != agentToken {
			c.JSON(401, gin.H{"error": "unauthorized"})
			return
		}
		jobID := c.Param("job_id")
		jobDir := filepath.Join(agentHome, jobID)
		rcPath := filepath.Join(jobDir, "rc")
		statusPath := filepath.Join(jobDir, "status.txt")
		logPath := filepath.Join(jobDir, "run.log")
		pidPath := filepath.Join(jobDir, "pid")

		// Always read status and rc from files for latest state
		// 1. If rc file exists, use it and always update status.txt
		if rcBytes, err := os.ReadFile(rcPath); err == nil {
			rcStr := strings.TrimSpace(string(rcBytes))
			rc, err := strconv.Atoi(rcStr)
			if err != nil {
				rc = 1
			}
			statusVal := "SUCCEEDED"
			if rc != 0 {
				statusVal = "FAILED"
			}
			// Always update status.txt to match rc
			os.WriteFile(statusPath, []byte(statusVal), 0644)
			// Log status if changed
			lastStatus := ""
			if sBytes, err := os.ReadFile(logPath); err == nil {
				lastStatus = string(sBytes)
			}
			// Only log if not already present in log
			if !strings.Contains(lastStatus, "[agent] status="+statusVal) {
				f, _ := os.OpenFile(logPath, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
				f.WriteString("[agent] status=" + statusVal + "\n")
				f.Close()
			}
			// Include timing data in response like Python agents do
			response := gin.H{"status": statusVal, "job_id": jobID, "log_path": logPath, "rc": rc}
			startedAtPath := filepath.Join(jobDir, "started_at")
			finishedAtPath := filepath.Join(jobDir, "finished_at")
			if startedAtBytes, err := os.ReadFile(startedAtPath); err == nil {
				if startedAt, err := strconv.ParseInt(strings.TrimSpace(string(startedAtBytes)), 10, 64); err == nil {
					// Convert Unix timestamp to YYYY-MM-DD HH:MM:SS format like Python agents
					response["started_at"] = time.Unix(startedAt, 0).UTC().Format("2006-01-02 15:04:05")
				}
			}
			if finishedAtBytes, err := os.ReadFile(finishedAtPath); err == nil {
				if finishedAt, err := strconv.ParseInt(strings.TrimSpace(string(finishedAtBytes)), 10, 64); err == nil {
					// Convert Unix timestamp to YYYY-MM-DD HH:MM:SS format like Python agents
					response["finished_at"] = time.Unix(finishedAt, 0).UTC().Format("2006-01-02 15:04:05")
				}
			}
			c.JSON(200, response)
			return
		}
		// 2. If no rc, check for pid and process alive
		pid := 0
		if pidBytes, err := os.ReadFile(pidPath); err == nil {
			pid, _ = strconv.Atoi(string(pidBytes))
		}
		alive := false
		if pid > 0 {
			proc, err := os.FindProcess(pid)
			if err == nil {
				if err := proc.Signal(syscall.Signal(0)); err == nil {
					alive = true
				}
			}
		}
		if alive {
			lastStatus := ""
			if sBytes, err := os.ReadFile(statusPath); err == nil {
				lastStatus = string(sBytes)
			}
			if lastStatus != "RUNNING" {
				f, _ := os.OpenFile(logPath, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
				f.WriteString("[agent] status=RUNNING\n")
				f.Close()
				os.WriteFile(statusPath, []byte("RUNNING"), 0644)
			}
			// Include timing data for running jobs
			response := gin.H{"status": "RUNNING", "job_id": jobID, "log_path": logPath, "rc": nil}
			startedAtPath := filepath.Join(jobDir, "started_at")
			if startedAtBytes, err := os.ReadFile(startedAtPath); err == nil {
				if startedAt, err := strconv.ParseInt(strings.TrimSpace(string(startedAtBytes)), 10, 64); err == nil {
					// Convert Unix timestamp to YYYY-MM-DD HH:MM:SS format like Python agents
					response["started_at"] = time.Unix(startedAt, 0).UTC().Format("2006-01-02 15:04:05")
				}
			}
			c.JSON(200, response)
			return
		}
		// 3. Neither rc nor pid: job is starting or pending
		// Include timing data for starting jobs
		response := gin.H{"status": "RUNNING", "job_id": jobID, "log_path": logPath, "rc": nil, "info": "no pid/rc yet, job is starting"}
		startedAtPath := filepath.Join(jobDir, "started_at")
		if startedAtBytes, err := os.ReadFile(startedAtPath); err == nil {
			if startedAt, err := strconv.ParseInt(strings.TrimSpace(string(startedAtBytes)), 10, 64); err == nil {
				// Convert Unix timestamp to YYYY-MM-DD HH:MM:SS format like Python agents
				response["started_at"] = time.Unix(startedAt, 0).UTC().Format("2006-01-02 15:04:05")
			}
		}
		c.JSON(200, response)
	})

	r.GET("/logs/:job_id", func(c *gin.Context) {
		if c.GetHeader("X-Agent-Token") != agentToken {
			c.JSON(401, gin.H{"error": "unauthorized"})
			return
		}
		jobID := c.Param("job_id")
		logPath := filepath.Join(agentHome, jobID, "run.log")
		f, err := os.Open(logPath)
		if err != nil {
			c.JSON(404, gin.H{"error": "no log"})
			return
		}
		defer f.Close()
		c.DataFromReader(200, -1, "text/plain", f, nil)
	})

	r.POST("/stop/:job_id", func(c *gin.Context) {
		if c.GetHeader("X-Agent-Token") != agentToken {
			c.JSON(401, gin.H{"error": "unauthorized"})
			return
		}

		jobID := c.Param("job_id")

		// Parse request body for reason (optional)
		var req struct {
			Reason string `json:"reason"`
		}
		c.BindJSON(&req)

		jobDir := filepath.Join(agentHome, jobID)
		pidPath := filepath.Join(jobDir, "pid")
		logPath := filepath.Join(jobDir, "run.log")
		rcPath := filepath.Join(jobDir, "rc")
		statusPath := filepath.Join(jobDir, "status.txt")
		finishedAtPath := filepath.Join(jobDir, "finished_at")

		// Check if job already completed
		if rcBytes, err := os.ReadFile(rcPath); err == nil {
			c.JSON(200, gin.H{
				"message": "Job already completed",
				"job_id":  jobID,
				"rc":      string(rcBytes),
			})
			return
		}

		// Read PID file
		pidBytes, err := os.ReadFile(pidPath)
		if err != nil {
			c.JSON(404, gin.H{
				"error":  "Job not found or no PID file",
				"job_id": jobID,
			})
			return
		}

		pid, err := strconv.Atoi(strings.TrimSpace(string(pidBytes)))
		if err != nil || pid <= 0 {
			c.JSON(400, gin.H{
				"error":  "Invalid PID in file",
				"job_id": jobID,
			})
			return
		}

		// Find process
		proc, err := os.FindProcess(pid)
		if err != nil {
			c.JSON(404, gin.H{
				"error":  "Process not found",
				"job_id": jobID,
				"pid":    pid,
			})
			return
		}

		// Check if process is still alive
		if err := proc.Signal(syscall.Signal(0)); err != nil {
			// Process already dead, mark as failed
			os.WriteFile(rcPath, []byte("1"), 0644)
			os.WriteFile(statusPath, []byte("FAILED"), 0644)
			os.WriteFile(finishedAtPath, []byte(fmt.Sprintf("%d", time.Now().Unix())), 0644)

			c.JSON(200, gin.H{
				"message": "Process already terminated, marked as failed",
				"job_id":  jobID,
				"pid":     pid,
			})
			return
		}

		// Log stop request
		reason := req.Reason
		if reason == "" {
			reason = "Stop requested by Router"
		}

		logMsg := fmt.Sprintf("[agent] Stop requested: %s (PID: %d)\n", reason, pid)
		if f, err := os.OpenFile(logPath, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644); err == nil {
			f.WriteString(logMsg)
			f.Close()
		}

		// Try graceful termination first (SIGTERM)
		fmt.Printf("[go-agent] Sending SIGTERM to job %s (PID: %d)\n", jobID, pid)
		err = proc.Signal(syscall.SIGTERM)
		if err != nil {
			c.JSON(500, gin.H{
				"error":  "Failed to send SIGTERM",
				"job_id": jobID,
				"pid":    pid,
			})
			return
		}

		// Wait up to 5 seconds for graceful termination
		terminated := false
		for i := 0; i < 50; i++ { // 50 * 100ms = 5 seconds
			time.Sleep(100 * time.Millisecond)
			if err := proc.Signal(syscall.Signal(0)); err != nil {
				terminated = true
				break
			}
		}

		// If still alive, force kill with SIGKILL
		if !terminated {
			fmt.Printf("[go-agent] Process still alive, sending SIGKILL to job %s (PID: %d)\n", jobID, pid)
			if f, err := os.OpenFile(logPath, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644); err == nil {
				f.WriteString("[agent] Graceful termination timeout, sending SIGKILL\n")
				f.Close()
			}

			err = proc.Signal(syscall.SIGKILL)
			if err != nil {
				c.JSON(500, gin.H{
					"error":  "Failed to send SIGKILL",
					"job_id": jobID,
					"pid":    pid,
				})
				return
			}

			// Wait a bit more for SIGKILL to take effect
			for i := 0; i < 20; i++ { // 20 * 100ms = 2 seconds
				time.Sleep(100 * time.Millisecond)
				if err := proc.Signal(syscall.Signal(0)); err != nil {
					terminated = true
					break
				}
			}
		}

		// Write completion files
		os.WriteFile(rcPath, []byte("1"), 0644) // Exit code 1 for killed process
		os.WriteFile(statusPath, []byte("FAILED"), 0644)
		os.WriteFile(finishedAtPath, []byte(fmt.Sprintf("%d", time.Now().Unix())), 0644)

		// Final log entry
		statusMsg := "terminated gracefully"
		if !terminated {
			statusMsg = "force killed (may still be running)"
		}

		finalLogMsg := fmt.Sprintf("[agent] Process %s, marked as FAILED\n", statusMsg)
		if f, err := os.OpenFile(logPath, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644); err == nil {
			f.WriteString(finalLogMsg)
			f.Close()
		}

		fmt.Printf("[go-agent] Job %s stopped (PID: %d, %s)\n", jobID, pid, statusMsg)

		c.JSON(200, gin.H{
			"message":    fmt.Sprintf("Job stopped successfully (%s)", statusMsg),
			"job_id":     jobID,
			"pid":        pid,
			"terminated": terminated,
		})
	})

	r.Run(":8001")
}

// Auto-register logic with secure registration only
func autoRegisterForever(agentID, selfURL, agentLabels, agentToken, routerURL, agentHome string) {
	// Try secure registration
	ok := secureRegister(agentID, agentID, selfURL, agentLabels, routerURL, agentHome)
	if ok {
		fmt.Println("[go-agent] Secure registration completed")
		return // Registration successful, no need to retry
	} else {
		fmt.Println("[go-agent] Secure registration failed, will retry")
	}

	// Retry loop for failed registration attempts
	for {
		time.Sleep(10 * time.Second) // Retry every 10 seconds until successful

		ok = secureRegister(agentID, agentID, selfURL, agentLabels, routerURL, agentHome)
		if ok {
			fmt.Println("[go-agent] Secure registration completed on retry")
			return // Success, exit the retry loop
		}
		fmt.Println("[go-agent] Secure registration retry failed, will continue retrying")
	}
}

func parseLabels(s string) map[string]interface{} {
	var m map[string]interface{}
	_ = json.Unmarshal([]byte(s), &m)
	return m
}

// Heartbeat logic
func heartbeatLoop(agentID, selfURL, agentToken, routerURL string, heartbeatSeconds int) {
	for {
		heartbeatOnce(agentID, selfURL, agentToken, routerURL)
		time.Sleep(time.Duration(heartbeatSeconds) * time.Second)
	}
}

func heartbeatOnce(agentID, selfURL, agentToken, routerURL string) {
	client := &http.Client{Timeout: 5 * time.Second}
	body := map[string]interface{}{
		"agent_id": agentID,
		"url":      selfURL,
	}
	b, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", routerURL+"/agents/heartbeat", bytes.NewBuffer(b))
	if err != nil {
		return
	}
	req.Header.Set("X-Agent-Token", agentToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
}

func runJob(job *Job, timeout int) {
	job.Status = StatusRunning
	job.UpdatedAt = time.Now()

	// Create started_at timestamp file (Unix timestamp)
	jobDir := filepath.Dir(job.LogPath)
	startedAtPath := filepath.Join(jobDir, "started_at")
	startedAtTimestamp := strconv.FormatInt(time.Now().Unix(), 10)
	os.WriteFile(startedAtPath, []byte(startedAtTimestamp), 0644)

	shell := "sh" // Always use POSIX sh for portability

	logFile, err := os.Create(job.LogPath)
	if err != nil {
		job.Status = StatusFailed
		job.RC = 255
		job.UpdatedAt = time.Now()
		return
	}
	defer logFile.Close()

	// jobDir already declared above for timing files

	// Log command and CWD
	logFile.WriteString("Command: " + job.Command + "\n")
	logFile.WriteString("CWD: " + job.Cwd + "\n")

	// Check if CWD exists
	if job.Cwd != "" {
		if _, err := os.Stat(job.Cwd); err != nil {
			logFile.WriteString("Error: CWD does not exist: " + err.Error() + "\n")
			job.Status = StatusFailed
			job.RC = 254
			job.UpdatedAt = time.Now()
			return
		}
	}

	// POSIX-compliant: always use sh, background the whole subshell, use only portable syntax
	rcPath := filepath.Join(jobDir, "rc")
	finishedAtPath := filepath.Join(jobDir, "finished_at")
	// Use sh -c '<cmd>' so $? is always the user command's exit code
	safeCmd := strings.ReplaceAll(job.Command, "'", "'\\''")
	// Escape single quotes for the outer command
	safeCoreCmd := strings.ReplaceAll("( cd '"+jobDir+"' || exit 255; sh -c '"+safeCmd+"'; echo $? > '"+rcPath+"'; date +%s > '"+finishedAtPath+"' )", "'", "'\\''")
	launchCmd := "setsid nohup sh -c '" + safeCoreCmd + "' >> '" + job.LogPath + "' 2>&1 & echo $!"
	logFile.WriteString("[agent] launchCmd: " + launchCmd + "\n")
	cmd := exec.Command(shell, "-c", launchCmd)
	cmd.Dir = "/" // always start from root, cd in shell
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		logFile.WriteString("Error: Failed to start command: " + err.Error() + "\n")
		job.Status = StatusFailed
		job.RC = 255
		job.UpdatedAt = time.Now()
		return
	}
	// Wait for the shell to finish (it should exit immediately after echoing $!)
	cmd.Wait()
	// Read the last line of the log file to get the PID
	pid := 0
	if f, err := os.Open(job.LogPath); err == nil {
		defer f.Close()
		stat, _ := f.Stat()
		size := stat.Size()
		if size > 4096 {
			f.Seek(-4096, 2)
		}
		buf := make([]byte, 4096)
		n, _ := f.Read(buf)
		lines := bytes.Split(buf[:n], []byte("\n"))
		for i := len(lines) - 1; i >= 0; i-- {
			line := string(lines[i])
			if p, err := strconv.Atoi(line); err == nil && p > 0 {
				pid = p
				break
			}
		}
	}
	job.PID = pid
	// Write PID file
	pidPath := filepath.Join(jobDir, "pid")
	os.WriteFile(pidPath, []byte(strconv.Itoa(job.PID)), 0644)
	// No need to wait for the detached process; just return
	// The status endpoint will check the process and update status/rc as needed
}

// getExitCode extracts the exit code from an error returned by exec.Cmd.Wait()
func getExitCode(err error) int {
	if err == nil {
		return 0
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
			return status.ExitStatus()
		}
	}
	return 1 // default if unknown
}
