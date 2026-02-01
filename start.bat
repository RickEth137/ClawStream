@echo off
wsl -d Ubuntu -e bash -c "fuser -k 3001/tcp 2>/dev/null; fuser -k 5173/tcp 2>/dev/null"
timeout /t 1 >nul
wt -w 0 new-tab --title "Server" wsl -d Ubuntu -e bash -c "cd /home/claw/Lobster && node server/index.js" ; new-tab --title "Mao Bot" wsl -d Ubuntu -e bash -c "sleep 2 && cd /home/claw/Lobster && node server/mao-streamer.js" ; new-tab --title "Frontend" wsl -d Ubuntu -e bash -c "cd /home/claw/Lobster && npm run dev"
