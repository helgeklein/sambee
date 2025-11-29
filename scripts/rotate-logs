#!/bin/bash

# Rotate and archive logs
# Useful when logs get too large

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVE_DIR="/tmp/logs-archive"

mkdir -p "$ARCHIVE_DIR"

echo "🔄 Rotating logs..."

for log_file in /tmp/*.log; do
    if [ -f "$log_file" ]; then
        filename=$(basename "$log_file")
        size=$(ls -lh "$log_file" | awk '{print $5}')
        
        # Only rotate if file is larger than 1KB
        if [ $(stat -c%s "$log_file" 2>/dev/null || stat -f%z "$log_file" 2>/dev/null) -gt 1024 ]; then
            archive_name="${filename%.log}_${TIMESTAMP}.log"
            echo "  📦 $filename ($size) → $ARCHIVE_DIR/$archive_name"
            cp "$log_file" "$ARCHIVE_DIR/$archive_name"
            
            # Truncate the log file (keep file descriptor open for running processes)
            > "$log_file"
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] Log rotated. Previous logs archived to: $ARCHIVE_DIR/$archive_name" >> "$log_file"
        else
            echo "  ⏭️  $filename ($size) - too small, skipping"
        fi
    fi
done

echo ""
echo "✅ Log rotation complete!"
echo "   Archive location: $ARCHIVE_DIR"
echo ""
echo "Archived logs:"
ls -lh "$ARCHIVE_DIR" | grep -v "^total" | awk '{print "  " $9 " (" $5 ")"}'
