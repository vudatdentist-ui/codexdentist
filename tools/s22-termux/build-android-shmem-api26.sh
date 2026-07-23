#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

TERMUX_PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PREFIX="$TERMUX_PREFIX"
export PATH="$TERMUX_PREFIX/bin:$PATH"

TERMUX_HOME="$(cd "$TERMUX_PREFIX/../home" && pwd)"
SRC_DIR="$TERMUX_HOME/src/libandroid-shmem"
OUT_DIR="$TERMUX_HOME/libandroid-shmem-api26"

APT_OPTIONS=(
  -o Dpkg::Options::=--force-confdef
  -o Dpkg::Options::=--force-confold
)

apt-get "${APT_OPTIONS[@]}" install -y clang make git

mkdir -p "$TERMUX_HOME/src" "$OUT_DIR"

if [ ! -d "$SRC_DIR/.git" ]; then
  git clone --depth 1 https://github.com/termux/libandroid-shmem.git "$SRC_DIR"
else
  git -C "$SRC_DIR" fetch --depth 1 origin master
  git -C "$SRC_DIR" reset --hard origin/master
fi

cd "$SRC_DIR"
make clean || true
rm -f shmem.o libandroid-shmem.so
make libandroid-shmem.so CC="clang --target=aarch64-linux-android26" CFLAGS="-fpic -shared -std=c11 -Wall -Wextra"
cp libandroid-shmem.so "$OUT_DIR/libandroid-shmem.so"

echo "Built $OUT_DIR/libandroid-shmem.so"
