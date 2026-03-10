#!/bin/bash
set -e
cd /home/ubuntu/mono
BRANCH="${1:-feature/hospital-plastic-surgery}"
git pull origin "$BRANCH"
npm run build
pm2 restart mono
