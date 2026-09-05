package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var downloadQueueMu sync.Mutex
var downloadWake = make(chan struct{}, 1)
var downloadFailures sync.Map
var activeDownload string

func readDownloadQueue() []string {
	data, _ := os.ReadFile(filepath.Join(scriptsDir, "db", "download_queue.txt"))
	queue := []string{}
	seen := map[string]bool{}
	for _, line := range strings.Split(string(data), "\n") {
		id := strings.ToUpper(strings.TrimSpace(line))
		if validVideoID(id) && !seen[id] {
			queue = append(queue, id)
			seen[id] = true
		}
	}
	return queue
}

func writeDownloadQueue(queue []string) error {
	dir := filepath.Join(scriptsDir, "db")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".queue-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.WriteString(strings.Join(queue, "\n") + "\n"); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(dir, "download_queue.txt"))
}

func enqueueDownload(id string) error {
	downloadQueueMu.Lock()
	defer downloadQueueMu.Unlock()
	if id == activeDownload {
		return nil
	}
	queue := readDownloadQueue()
	for _, queued := range queue {
		if queued == id {
			return nil
		}
	}
	if len(queue) >= 1000 {
		return fmt.Errorf("download queue is full")
	}
	if err := writeDownloadQueue(append(queue, id)); err != nil {
		return err
	}
	downloadFailures.Delete(id)
	select {
	case downloadWake <- struct{}{}:
	default:
	}
	return nil
}

func startDownloadWorker() {
	// Resume an interrupted download before the persisted pending queue.
	if data, err := os.ReadFile(filepath.Join(scriptsDir, "work")); err == nil {
		id := strings.TrimSpace(string(data))
		if validVideoID(id) && id != "0" {
			_ = enqueueDownload(id)
		}
	}
	go func() {
		for {
			select {
			case <-workerContext.Done():
				return
			default:
			}
			downloadQueueMu.Lock()
			queue := readDownloadQueue()
			if len(queue) == 0 {
				downloadQueueMu.Unlock()
				select {
				case <-workerContext.Done():
					return
				case <-downloadWake:
					continue
				}
			}
			id := queue[0]
			activeDownload = id
			// Keep the active ID persisted until the process has finished.
			downloadQueueMu.Unlock()
			_, stderr, err := runPython("main.py", []string{id}, map[string]string{"YINGBOX_QUEUE_MANAGED": "1"})
			downloadQueueMu.Lock()
			activeDownload = ""
			if workerContext.Err() != nil {
				downloadQueueMu.Unlock()
				return
			}
			pending := readDownloadQueue()
			remaining := make([]string, 0, len(pending))
			for _, queued := range pending {
				if queued != id {
					remaining = append(remaining, queued)
				}
			}
			if saveErr := writeDownloadQueue(remaining); saveErr != nil {
				logger.Printf("Cannot update download queue: %v", saveErr)
				downloadQueueMu.Unlock()
				return
			}
			downloadQueueMu.Unlock()
			if err != nil {
				downloadFailures.Store(id, err.Error())
				logger.Printf("Download %s failed: %v; %s", id, err, stderr)
			}
		}
	}()
}
