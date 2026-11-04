#!/bin/sh
set -eu

echo 'Local CPU runtime: waiting for models/llm/model.gguf. No model is downloaded automatically.'
child=''
failed_file=''
stop() {
  if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null || true; wait "$child" || true; fi
  exit 0
}
trap stop TERM INT
while :; do
  if [ ! -s /models/model.gguf ]; then sleep 5; continue; fi
  identity=$(stat -c '%i:%s:%Y:%Z' /models/model.gguf 2>/dev/null) || { sleep 1; continue; }
  if [ "$identity" = "$failed_file" ]; then sleep 5; continue; fi
  if [ "$(head -c 4 /models/model.gguf)" != 'GGUF' ]; then
    echo 'Invalid GGUF header. Replace the completed model file; application remains available.'
    failed_file=$identity
    continue
  fi
  # Alias identifies the exact bytes served, matching the API run snapshot.
  digest=$(sha256sum /models/model.gguf)
  digest=${digest%% *}
  case "$digest" in *[!a-f0-9]*|'') echo 'Cannot identify model file'; sleep 5; continue ;; esac
  echo 'Loading local model on CPU.'
  /app/llama-server \
    --model /models/model.gguf \
    --alias "reviewlens-local-$digest" \
    --host 0.0.0.0 --port 8081 \
    --ctx-size "${LOCAL_LLM_CONTEXT_TOKENS:-4096}" \
    --threads "${LOCAL_LLM_THREADS:-4}" \
    --parallel 1 --n-gpu-layers 0 \
    --jinja --reasoning-budget 0 \
    --no-webui &
  child=$!
  wait "$child" || true
  child=''
  failed_file=$identity
  echo 'Local model stopped. Check logs, replace the file or restart the application. Waiting without blocking the application.'
done
