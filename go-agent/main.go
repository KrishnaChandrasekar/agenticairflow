package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
	"strconv"
	"encoding/json"
	"net/http"
	"bytes"
	"strings"
	"github.com/gin-gonic/gin"
	"syscall"
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
		jobs      = make(map[string]*Job)
		jobsMu    sync.Mutex
	)

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
		autoRegister := getEnvBool("AGENT_AUTO_REGISTER", true)


	       os.MkdirAll(agentHome, 0755)

	       // --- Reconciliation logic: scan job dirs and report to router ---
	       go func() {
		       jobs := []map[string]interface{}{}
		       entries, err := os.ReadDir(agentHome)
		       if err == nil {
			       for _, entry := range entries {
				       if !entry.IsDir() { continue }
				       jobID := entry.Name()
				       jobDir := filepath.Join(agentHome, jobID)
				       pidPath := filepath.Join(jobDir, "pid")
				       rcPath := filepath.Join(jobDir, "rc")
				       status := "UNKNOWN"
				       var pid *int = nil
				       var rc *int = nil
				       // Read pid
				       if b, err := os.ReadFile(pidPath); err == nil {
					       if p, err := strconv.Atoi(string(b)); err == nil {
						       pid = &p
					       }
				       }
				       // Check if process is alive
				       alive := false
				       if pid != nil && *pid > 0 {
					       proc, err := os.FindProcess(*pid)
					       if err == nil {
						       if err := proc.Signal(syscall.Signal(0)); err == nil {
							       alive = true
						       }
					       }
				       }
				       if alive {
					       status = "RUNNING"
				       } else if b, err := os.ReadFile(rcPath); err == nil {
					       if r, err := strconv.Atoi(string(b)); err == nil {
						       rc = &r
						       if r == 0 {
							       status = "SUCCEEDED"
						       } else {
							       status = "FAILED"
						       }
					       } else {
						       rcVal := 1
						       rc = &rcVal
						       status = "FAILED"
					       }
				       }
				       jobs = append(jobs, map[string]interface{}{
					       "job_id": jobID,
					       "status": status,
					       "pid": func() interface{} { if pid != nil { return *pid } else { return nil } }(),
					       "rc": func() interface{} { if rc != nil { return *rc } else { return nil } }(),
				       })
			       }
		       }
		       if len(jobs) > 0 {
			       payload := map[string]interface{}{
				       "agent_id": agentID,
				       "jobs": jobs,
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
				       }
			       }
		       }
	       }()

		// Auto-register and heartbeat
		if autoRegister {
			go autoRegisterForever(agentID, selfURL, agentLabels, agentToken, routerURL)
		}
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
				   c.JSON(200, gin.H{"status": statusVal, "job_id": jobID, "log_path": logPath, "rc": rc})
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
				   c.JSON(200, gin.H{"status": "RUNNING", "job_id": jobID, "log_path": logPath, "rc": nil})
				   return
			   }
			   // 3. Neither rc nor pid: job is starting or pending
			   c.JSON(200, gin.H{"status": "RUNNING", "job_id": jobID, "log_path": logPath, "rc": nil, "info": "no pid/rc yet, job is starting"})
			   return
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

		r.Run(":8001")
	}

	// Auto-register logic
	func autoRegisterForever(agentID, selfURL, agentLabels, agentToken, routerURL string) {
		body := map[string]interface{}{
			"agent_id": agentID,
			"url": selfURL,
			"labels": parseLabels(agentLabels),
		}
		headers := map[string]string{
			"X-Agent-Token": agentToken,
			"Content-Type": "application/json",
		}
		for {
			ok := autoRegisterOnce(body, headers, routerURL)
			delay := 60
			if !ok {
				delay = 10
			}
			time.Sleep(time.Duration(delay) * time.Second)
		}
	}

	func autoRegisterOnce(body map[string]interface{}, headers map[string]string, routerURL string) bool {
		client := &http.Client{Timeout: 5 * time.Second}
		b, _ := json.Marshal(body)
		req, err := http.NewRequest("POST", routerURL+"/agents/register", bytes.NewBuffer(b))
		if err != nil {
			return false
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		resp, err := client.Do(req)
		if err != nil {
			return false
		}
		defer resp.Body.Close()
		return resp.StatusCode == 200
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
			"url": selfURL,
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

	   shell := "sh" // Always use POSIX sh for portability

	   logFile, err := os.Create(job.LogPath)
	   if err != nil {
		   job.Status = StatusFailed
		   job.RC = 255
		   job.UpdatedAt = time.Now()
		   return
	   }
	   defer logFile.Close()

		// Prepare jobDir for pid/log files
		jobDir := filepath.Dir(job.LogPath)

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
				// Use sh -c '<cmd>' so $? is always the user command's exit code
				safeCmd := strings.ReplaceAll(job.Command, "'", "'\\''")
					core := "( cd '" + jobDir + "' || exit 255; sh -c '" + safeCmd + "'; echo $? > '" + rcPath + "' )"
					launchCmd := "setsid nohup sh -c \"" + core + "\" >> '" + job.LogPath + "' 2>&1 & echo $!"
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
		   if size > 4096 { f.Seek(-4096, 2) }
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
	   return
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
