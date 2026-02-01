#!/bin/bash
cd /home/claw/Lobster

# Kill any existing processes on the ports
fuser -k 3001/tcp 2>/dev/null
fuser -k 5173/tcp 2>/dev/null
sleep 1

# Start the server in background
echo \
