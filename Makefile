WASM := pwa/public/portpass.wasm

.PHONY: wasm wasm_exec setup build test dev clean

wasm:
	GOOS=js GOARCH=wasm go build -o $(WASM) ./cmd/wasm
	gzip -f $(WASM)

wasm_exec:
	cp "$$(go env GOROOT)/lib/wasm/wasm_exec.js" ./pwa/public/

setup: wasm_exec
	cd pwa && npm install

build: wasm wasm_exec
	cd pwa && npm run build

test:
	go test ./pwsafe/...

dev: wasm wasm_exec
	cd pwa && npm run dev

clean:
	rm -f pwa/public/portpass.wasm pwa/public/portpass.wasm.gz pwa/public/wasm_exec.js
	rm -rf pwa/dist
