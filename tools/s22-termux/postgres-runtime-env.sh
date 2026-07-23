#!/data/data/com.termux/files/usr/bin/bash

TERMUX_PREFIX="${TERMUX_PREFIX:-${PREFIX:-/data/data/com.termux/files/usr}}"
TERMUX_HOME="${TERMUX_HOME:-$(cd "$TERMUX_PREFIX/../home" && pwd)}"
CODEXMED_ANDROID_SHMEM_LIB_DIR="${CODEXMED_ANDROID_SHMEM_LIB_DIR:-$TERMUX_HOME/libandroid-shmem-api26}"

clean_android_shmem_keys() {
  rm -f "$TERMUX_PREFIX/tmp"/ashv_key_* 2>/dev/null || true
}

postgres_runtime_env() {
  if [ -f "$CODEXMED_ANDROID_SHMEM_LIB_DIR/libandroid-shmem.so" ]; then
    LD_LIBRARY_PATH="$CODEXMED_ANDROID_SHMEM_LIB_DIR" "$@"
  else
    "$@"
  fi
}
