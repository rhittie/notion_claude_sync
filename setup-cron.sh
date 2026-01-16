#!/bin/bash

# Setup cron job for weekly Monday morning sync
# Run this script from your project directory

PROJECT_DIR=$(pwd)
CRON_CMD="0 9 * * 1 cd $PROJECT_DIR && node sync-to-notion.js >> notion-sync.log 2>&1"

echo "📅 Setting up weekly Notion sync (Mondays at 9 AM)"
echo ""
echo "Adding to crontab:"
echo "  $CRON_CMD"
echo ""

# Add to crontab (avoiding duplicates)
(crontab -l 2>/dev/null | grep -v "sync-to-notion.js"; echo "$CRON_CMD") | crontab -

echo "✅ Cron job installed!"
echo ""
echo "To verify: crontab -l"
echo "To remove: crontab -e (and delete the line)"
echo ""
echo "Logs will be written to: $PROJECT_DIR/notion-sync.log"
