# Snake Online Server

## Run

```bash
cd gametest/server
npm install
npm start
```

Server mặc định chạy tại `ws://localhost:8080`.

## Scope

Triển khai theo **Bước 1** trong `ONLINE_PVP_DESIGN.md`:
- Matchmaking 2-10 người
- Countdown 5s
- Tick 10Hz (server-authoritative)
- Map 2000x2000
- Trái cây thường + xác rắn thành trái tím 30s
- Va chạm, kill feed, spectate, kết quả trận
