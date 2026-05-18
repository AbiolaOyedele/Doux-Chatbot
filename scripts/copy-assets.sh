#!/bin/sh
# Copies fonts and template images from flyer-gen/public into chat-bot/assets.
# Run once from the chat-bot directory: sh scripts/copy-assets.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/.."
SOURCE="$ROOT/../flyer-gen/public"

mkdir -p "$ROOT/assets/fonts" "$ROOT/assets/templates"

cp "$SOURCE/fonts/RedditSans-SemiBold.ttf" "$ROOT/assets/fonts/"
cp "$SOURCE/templates/dark-doux.png"       "$ROOT/assets/templates/"

echo "Assets copied to chat-bot/assets/"
