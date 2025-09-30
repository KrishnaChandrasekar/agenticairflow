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

			   // 1. If rc file exists, use it
			   if rcBytes, err := os.ReadFile(rcPath); err == nil {
				   rcStr := string(rcBytes)
				   rc, err := strconv.Atoi(rcStr)
				   if err != nil {
					   rc = 1
				   }
				   statusVal := "SUCCEEDED"
				   if rc != 0 {
					   statusVal = "FAILED"
				   }
				   // Log and persist status if changed
				   lastStatus := ""
				   if sBytes, err := os.ReadFile(statusPath); err == nil {
					   lastStatus = string(sBytes)
				   }
				   if lastStatus != statusVal {
					   f, _ := os.OpenFile(logPath, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
					   f.WriteString("[agent] status=" + statusVal + "\n")
					   f.Close()
					   os.WriteFile(statusPath, []byte(statusVal), 0644)
				   }
				   // Always return rc as integer, never string or null
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
					   // Try sending signal 0
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
				   // For running jobs, always return rc as nil (Go nil maps to JSON null)
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

	   shell := "sh"
	   if _, err := exec.LookPath("bash"); err == nil {
		   shell = "bash"
	   }

	   logFile, err := os.Create(job.LogPath)
	   if err != nil {
		   job.Status = StatusFailed
		   job.RC = 255
		   job.UpdatedAt = time.Now()
		   return
	   }
	   defer logFile.Close()

	   // Prepare status and rc file paths
	   jobDir := filepath.Dir(job.LogPath)
	   statusPath := filepath.Join(jobDir, "status.txt")
	   rcPath := filepath.Join(jobDir, "rc")

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

	   cmd := exec.Command(shell, "-c", job.Command)
	   cmd.Dir = job.Cwd
	   cmd.Stdout = logFile
	   cmd.Stderr = logFile
	   if err := cmd.Start(); err != nil {
		   logFile.WriteString("Error: Failed to start command: " + err.Error() + "\n")
		   job.Status = StatusFailed
		   job.RC = 255
		   job.UpdatedAt = time.Now()
		   return
	   }
	   job.PID = cmd.Process.Pid
	   // Write PID file
	   pidPath := filepath.Join(jobDir, "pid")
	   os.WriteFile(pidPath, []byte(strconv.Itoa(job.PID)), 0644)
	   done := make(chan error)
	   go func() { done <- cmd.Wait() }()

	   // Only update status/RC if job is not already completed
	   setFinal := func(rc int) {
		   jobsMu.Lock()
		   if job.Status != StatusSucceeded && job.Status != StatusFailed {
			   job.RC = rc
			   statusVal := "SUCCEEDED"
			   if rc != 0 {
				   statusVal = "FAILED"
			   }
			   job.Status = JobStatus(statusVal)
			   job.UpdatedAt = time.Now()
			   // Write status and rc atomically: write to temp file then rename
			   tmpStatus := statusPath + ".tmp"
			   tmpRC := rcPath + ".tmp"
			   os.WriteFile(tmpStatus, []byte(statusVal), 0644)
			   os.WriteFile(tmpRC, []byte(strconv.Itoa(rc)), 0644)
			   os.Rename(tmpStatus, statusPath)
			   os.Rename(tmpRC, rcPath)
			   f, err := os.OpenFile(job.LogPath, os.O_APPEND|os.O_WRONLY, 0644)
			   if err == nil {
				   f.WriteString("[agent] return code: " + strconv.Itoa(rc) + "\n")
				   f.WriteString("[agent] status=" + statusVal + "\n")
				   f.Close()
			   }
			   // ...removed debug log...
		   }
		   jobsMu.Unlock()
	   }

	   if timeout > 0 {
		   select {
		   case err := <-done:
			   rc := getExitCode(err)
			   if err != nil {
				   logFile.WriteString("Error: Command execution failed: " + err.Error() + "\n")
			   }
			   // Always set RC=0 if err==nil
			   if err == nil {
				   setFinal(0)
			   } else {
				   setFinal(rc)
			   }
		   case <-time.After(time.Duration(timeout) * time.Second):
			   cmd.Process.Kill()
			   logFile.WriteString("Error: Command timed out\n")
			   setFinal(255)
		   }
	   } else {
		   err := <-done
		   rc := getExitCode(err)
		   if err != nil {
			   logFile.WriteString("Error: Command execution failed: " + err.Error() + "\n")
		   }
		   if err == nil {
			   setFinal(0)
		   } else {
			   setFinal(rc)
		   }
	   }
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
