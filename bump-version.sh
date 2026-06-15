#!/bin/sh
# 一鍵升版：把所有 ?v=N 換成下一個數字 → 瀏覽器強制重抓新 JS/CSS（免手動清快取）
# 用法： sh bump-version.sh
cd "$(dirname "$0")" || exit 1
cur=$(grep -o 'main.js?v=[0-9]*' index.html | grep -o '[0-9]*$')
[ -z "$cur" ] && cur=1
next=$((cur + 1))
sed -i '' -E "s/\?v=[0-9]+/?v=$next/g" index.html js/game.js js/catalog.js js/main.js
echo "版本 v$cur → v$next（已更新 index.html 與 js/*.js）"
