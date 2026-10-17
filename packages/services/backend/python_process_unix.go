//go:build !windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

// pythonCandidatePaths 返回 Unix 上常见的 Python 安装位
func pythonCandidatePaths() []string {
	out := []string{"/usr/local/bin/python3", "/usr/bin/python3", "/opt/homebrew/bin/python3"}
	if home, err := os.UserHomeDir(); err == nil {
		out = append(out, filepath.Join(home, ".local", "bin", "python3"))
	}
	return out
}

func configurePythonProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
}
