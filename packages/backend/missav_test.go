package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestMissavListAndCoverQuery(t *testing.T) {
	for _, target := range []string{"/api/missav/list?page=0", "/api/missav/list?category=genres", "/api/missav/cover", "/api/missav/cover?code=new", "/api/missav/cover?code=../a"} {
		result := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, target, nil)
		if strings.Contains(target, "/cover") {
			missavCoverHandler(result, request)
		} else {
			missavListHandler(result, request)
		}
		if result.Code != http.StatusBadRequest {
			t.Fatalf("%s accepted: %d", target, result.Code)
		}
	}
}

func TestMissavPlaylistRewrite(t *testing.T) {
	base, _ := url.Parse("https://surrit.com/video/720/playlist.m3u8")
	input := "#EXTM3U\r\n#EXT-X-KEY:METHOD=AES-128,URI=\"../key.bin?token=abc\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:5,\nsegment.ts?token=a%2Bb\n#EXT-X-ENDLIST\n"
	rewritten, err := rewriteMissavPlaylist([]byte(input), base, "test-key")
	if err != nil {
		t.Fatal(err)
	}
	text := string(rewritten)
	for _, expected := range []string{"./key.bin?", "./init.mp4?", "./segment.ts?", "key=test-key", "#EXT-X-ENDLIST"} {
		if !strings.Contains(text, expected) {
			t.Errorf("missing %q: %s", expected, text)
		}
	}
	var segment string
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "./segment.ts?") {
			segment = line
		}
	}
	parsed, _ := url.Parse(segment)
	if got := parsed.Query().Get("url"); got != "https://surrit.com/video/720/segment.ts?token=a%2Bb" {
		t.Fatal(got)
	}
	for _, input := range []string{"#EXTM3U\nhttp://127.0.0.1/a.ts", "#EXTM3U\nhttps://surrit.com.evil.test/a.ts", "#EXTM3U\n#EXT-X-KEY:URI=\"https://evil.test/key\"", "<html>blocked</html>"} {
		if _, err := rewriteMissavPlaylist([]byte(input), base, ""); err == nil {
			t.Errorf("accepted unsafe/invalid playlist: %s", input)
		}
	}
}

type missavTestTransport func(*http.Request) (*http.Response, error)

func (f missavTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestMissavStreamRange(t *testing.T) {
	// Substitute the upstream transport, keeping the production CDN allowlist in effect.
	client := missavHTTPClient()
	previous := client.Transport
	t.Cleanup(func() { client.Transport = previous })
	client.Transport = missavTestTransport(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Range") != "bytes=100-103" || r.Header.Get("Referer") != "https://missav.ai/" {
			t.Fatal("range/referer not forwarded")
		}
		return &http.Response{StatusCode: 206, Header: http.Header{"Content-Range": {"bytes 100-103/1000"}, "Content-Type": {"video/mp2t"}, "Content-Length": {"4"}}, Body: io.NopCloser(strings.NewReader("data")), Request: r}, nil
	})
	request := httptest.NewRequest("GET", "/api/missav/stream/a.ts?url="+url.QueryEscape("https://surrit.com/video/a.ts"), nil)
	request.Header.Set("Range", "bytes=100-103")
	result := httptest.NewRecorder()
	missavStreamHandler(result, request)
	if result.Code != 206 || result.Body.String() != "data" || result.Header().Get("Content-Range") != "bytes 100-103/1000" {
		t.Fatal(result.Code, result.Header(), result.Body.String())
	}
	request = httptest.NewRequest("GET", "/api/missav/stream/a.ts?url="+url.QueryEscape("https://127.0.0.1/a.ts"), nil)
	result = httptest.NewRecorder()
	missavStreamHandler(result, request)
	if result.Code != 400 {
		t.Fatal("private target accepted")
	}
}
