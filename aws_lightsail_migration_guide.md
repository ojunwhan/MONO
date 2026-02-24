# MONO 서버 이전 가이드 — 집 PC → AWS Lightsail

## 왜 이전하나?
- 집 PC + Cloudflare Tunnel = 불안정한 연결의 근본 원인
- AWS Lightsail = 24시간 안정 운영, 직통 연결, 월 $5

---

## STEP 1: AWS 계정 만들기 (이미 있으면 건너뛰기)

1. https://aws.amazon.com 접속
2. "Create an AWS Account" 클릭
3. 이메일, 비밀번호, 계정 이름 입력
4. 신용카드 등록 (결제용 — $5/월만 나감)
5. 본인 인증 (전화번호)

---

## STEP 2: Lightsail 인스턴스 만들기

1. https://lightsail.aws.amazon.com 접속
2. "Create instance" 클릭
3. 설정:
   - Region: **Seoul (ap-northeast-2)** <- 한국 서버, 속도 빠름
   - Platform: **Linux/Unix**
   - Blueprint: **OS Only -> Ubuntu 22.04 LTS**
   - Instance plan: **$5/month** (1GB RAM, 1vCPU, 40GB SSD)
   - Instance name: `mono-server`
4. "Create instance" 클릭
5. 1~2분 기다리면 서버 생성 완료

---

## STEP 3: 고정 IP 연결

1. Lightsail 대시보드 -> Networking 탭
2. "Create static IP" 클릭
3. 방금 만든 `mono-server` 인스턴스에 연결
4. 이 IP 주소를 메모 (예: `13.125.xxx.xxx`)

---

## STEP 4: 포트 열기

1. Lightsail 대시보드 -> `mono-server` 클릭 -> Networking 탭
2. Firewall에서 아래 포트 추가:
   - **HTTP (80)** — 이미 있을 수 있음
   - **HTTPS (443)** — 추가
   - **Custom TCP 3174** — 추가 (MONO 서버 포트)
3. Save

---

## STEP 5: 서버에 접속

1. Lightsail 대시보드 -> `mono-server` 클릭
2. "Connect using SSH" 클릭 (브라우저에서 바로 터미널 열림)
3. 또는 SSH 키 다운로드 -> PuTTY나 터미널에서 접속:

```bash
ssh -i LightsailDefaultKey-ap-northeast-2.pem ubuntu@[고정IP]
```

---

## STEP 6: 서버 환경 설정 (SSH 터미널에서)

아래 명령어를 한 줄씩 복사해서 붙여넣기:

```bash
# 1. 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# 2. Node.js 20 설치
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. 설치 확인
node --version    # v20.x.x 나오면 성공
npm --version     # 10.x.x 나오면 성공

# 4. PM2 설치 (서버 자동 재시작 + 24시간 운영용)
sudo npm install -g pm2

# 5. Nginx 설치 (HTTPS + 리버스 프록시)
sudo apt install -y nginx

# 6. Certbot 설치 (무료 SSL 인증서)
sudo apt install -y certbot python3-certbot-nginx

# 7. Git 설치
sudo apt install -y git
```

---

## STEP 7: MONO 코드 배포

### 방법 A: Git 사용 (추천)
MONO 코드가 GitHub에 있으면:

```bash
cd /home/ubuntu
git clone https://github.com/[형님계정]/[mono-repo].git mono
cd mono
npm install
```

### 방법 B: 직접 업로드
GitHub에 없으면, 집 PC에서 MONO 폴더를 압축해서 업로드:

집 PC (PowerShell):

```powershell
# MONO 프로젝트 폴더를 압축 (node_modules 제외)
tar -czf mono.tar.gz --exclude=node_modules --exclude=.git -C C:\path\to\mono .

# AWS로 업로드
scp -i LightsailDefaultKey-ap-northeast-2.pem mono.tar.gz ubuntu@[고정IP]:/home/ubuntu/
```

AWS 서버 (SSH):

```bash
cd /home/ubuntu
mkdir mono
cd mono
tar -xzf ../mono.tar.gz
npm install
```

---

## STEP 8: 서버 테스트

```bash
cd /home/ubuntu/mono

# 서버 실행 테스트
node server.js
# "[SERVER] listening on port 3174" 나오면 성공

# Ctrl+C로 종료
```

브라우저에서 `http://[고정IP]:3174` 접속해서 MONO 화면 뜨는지 확인.

---

## STEP 9: 도메인 연결 (lingora.chat -> AWS)

### Cloudflare 기존 설정 변경
1. https://dash.cloudflare.com 접속
2. `lingora.chat` 도메인 선택
3. DNS 메뉴
4. 기존 레코드 수정:
   - **Type:** A
   - **Name:** @ (또는 lingora.chat)
   - **Content:** [AWS 고정 IP] <- 여기에 STEP 3에서 메모한 IP 입력
   - **Proxy status:** DNS only (회색 구름) <- 일단 프록시 끄기
5. Save

### 또는 Cloudflare 안 쓰고 직접 연결
도메인 등록업체(가비아, Namecheap 등)에서:
- A 레코드: `lingora.chat` -> [AWS 고정 IP]
- A 레코드: `www.lingora.chat` -> [AWS 고정 IP]

TTL 300초로 설정 (빠른 전환)

---

## STEP 10: Nginx + HTTPS 설정

```bash
# Nginx 설정 파일 만들기
sudo nano /etc/nginx/sites-available/mono
```

아래 내용 붙여넣기:

```nginx
server {
    listen 80;
    server_name lingora.chat www.lingora.chat;

    location / {
        proxy_pass http://127.0.0.1:3174;
        proxy_http_version 1.1;

        # WebSocket 지원 — 이게 핵심!
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 타임아웃 늘리기 (WebSocket 연결 유지)
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

저장: `Ctrl+O` -> Enter -> `Ctrl+X`

```bash
# 설정 활성화
sudo ln -s /etc/nginx/sites-available/mono /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default

# Nginx 테스트 & 재시작
sudo nginx -t
sudo systemctl restart nginx

# SSL 인증서 발급 (무료)
sudo certbot --nginx -d lingora.chat -d www.lingora.chat
# 이메일 입력 -> 약관 동의(Y) -> 리다이렉트(2번)

# SSL 자동 갱신 확인
sudo certbot renew --dry-run
```

---

## STEP 11: PM2로 서버 영구 실행

```bash
cd /home/ubuntu/mono

# PM2로 서버 시작
pm2 start server.js --name mono

# 서버 재부팅 시 자동 시작 설정
pm2 startup
pm2 save

# 상태 확인
pm2 status
# mono | online 나오면 성공

# 로그 보기
pm2 logs mono
```

---

## STEP 12: 최종 확인

1. 브라우저에서 **https://lingora.chat** 접속
2. QR 코드 화면 뜨는지 확인
3. 다른 폰(WiFi 또는 데이터)으로 QR 스캔
4. 양쪽 대화방 입장 -> 마이크 -> 번역 확인

### 확인 체크리스트
- [ ] https://lingora.chat 접속 됨 (HTTPS)
- [ ] QR 코드 생성 됨
- [ ] 다른 네트워크(데이터)에서 게스트 접속 됨
- [ ] 양방향 텍스트 전송/번역 됨
- [ ] 마이크 STT 됨
- [ ] 연결 안정적 (끊김 없음)

---

## STEP 13: 집 PC 정리

모든 테스트 통과 후:

1. 집 PC에서 `cloudflared` 서비스 중지
2. `node server.js` 중지
3. 이제 PC 꺼도 `lingora.chat` 정상 작동

---

## 비용 정리

| 항목 | 비용 |
|---|---|
| AWS Lightsail | $5/월 (약 7,000원) |
| SSL 인증서 | 무료 (Let's Encrypt) |
| 도메인 유지 | 기존과 동일 |
| **합계** | **월 7,000원** |

---

## 이전 후 달라지는 것

| 항목 | 기존 (집 PC) | AWS 이전 후 |
|---|---|---|
| 서버 가동 | PC 켜야 함 | 24시간 자동 |
| 연결 경로 | 폰 -> Cloudflare -> Tunnel -> 집PC | 폰 -> AWS 직통 |
| 속도 | 느림 (Tunnel 경유) | 빠름 (서울 리전) |
| 안정성 | 집 인터넷 의존 | AWS 인프라 |
| WebSocket | Tunnel 간섭 가능 | Nginx 직통 지원 |
| HTTPS | Cloudflare 프록시 | Let's Encrypt 직접 |

---

## 문제 생기면

```bash
# 서버 상태 확인
pm2 status

# 서버 재시작
pm2 restart mono

# 로그 확인
pm2 logs mono --lines 50

# Nginx 상태
sudo systemctl status nginx

# SSL 인증서 상태
sudo certbot certificates
```
