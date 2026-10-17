//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
)

// pythonCandidatePaths 返回 Windows 上常见的 Python 安装位
// （python.org 安装器默认装到 %LOCALAPPDATA%\Programs\Python\；Conda/系统级另列）。
func pythonCandidatePaths() []string {
	out := []string{}
	if env := os.Getenv("LOCALAPPDATA"); env != "" {
		base := filepath.Join(env, "Programs", "Python")
		if entries, err := os.ReadDir(base); err == nil {
			// 版本目录按名倒序（新版本优先），如 Python312 > Python311
			names := []string{}
			for _, e := range entries {
				if e.IsDir() {
					names = append(names, e.Name())
				}
			}
			for i := 0; i < len(names); i++ {
				for j := i + 1; j < len(names); j++ {
					if names[j] > names[i] {
						names[i], names[j] = names[j], names[i]
					}
				}
			}
			for _, name := range names {
				out = append(out, filepath.Join(base, name, "python.exe"))
			}
		}
	}
	// 常见系统级安装
	out = append(out,
		`C:\Python313\python.exe`,
		`C:\Python312\python.exe`,
		`C:\Python311\python.exe`,
		`C:\Program Files\Python313\python.exe`,
		`C:\Program Files\Python312\python.exe`,
		`C:\Program Files\Python311\python.exe`,
	)
	return out
}

func configurePythonProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	cmd.Cancel = func() error {
		killer := exec.Command("taskkill", "/PID", strconv.Itoa(cmd.Process.Pid), "/T", "/F")
		killer.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if err := killer.Run(); err != nil {
			return cmd.Process.Kill()
		}
		return nil
	}
}
