package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

var pythonSlots = make(chan struct{}, 4)
var downloadSlots = make(chan struct{}, 1)
var workerContext, stopWorkers = context.WithCancel(context.Background())

// Keep the tail: Python emits its JSON result after diagnostic output.
type boundedOutput struct {
	mu    sync.Mutex
	data  []byte
	limit int
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	if n >= b.limit {
		b.data = append(b.data[:0], p[n-b.limit:]...)
	} else {
		overflow := len(b.data) + n - b.limit
		if overflow > 0 {
			b.data = b.data[overflow:]
		}
		b.data = append(b.data, p...)
	}
	return n, nil
}
func (b *boundedOutput) String() string { b.mu.Lock(); defer b.mu.Unlock(); return string(b.data) }

func runPythonContext(parent context.Context, timeout time.Duration, scriptRelPath string, args []string, envExtra map[string]string) (string, string, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	slots := pythonSlots
	if scriptRelPath == "main.py" {
		slots = downloadSlots
	}
	select {
	case slots <- struct{}{}:
		defer func() { <-slots }()
	case <-ctx.Done():
		return "", "", ctx.Err()
	}
	python := os.Getenv("PYTHON_EXECUTABLE")
	if python == "" {
		python = "python"
	}
	cmd := exec.CommandContext(ctx, python, append([]string{filepath.Join(scriptsDir, filepath.FromSlash(scriptRelPath))}, args...)...)
	configurePythonProcess(cmd)
	cmd.WaitDelay = 3 * time.Second
	cmd.Dir = scriptsDir
	cmd.Env = append(os.Environ(), "PYTHONIOENCODING=utf-8", "MISSAV_VIDEO_PATH="+getBasePath())
	for key, value := range envExtra {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	stdout := &boundedOutput{limit: 8 * 1024 * 1024}
	stderr := &boundedOutput{limit: 1024 * 1024}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		err = ctx.Err()
	}
	return stdout.String(), stderr.String(), err
}

func runPython(scriptRelPath string, args []string, envExtra map[string]string) (string, string, error) {
	return runPythonContext(workerContext, 12*time.Hour, scriptRelPath, args, envExtra)
}
