# Collectory DB 수집 흐름

## 목표

Vercel 서버가 KREAM/Collectory 실시간 요청에서 막혀도, 앱은 Supabase DB에 저장된 카드 시세를 먼저 조회합니다.

## 준비

1. Supabase Free 프로젝트를 만듭니다.
2. Supabase SQL Editor에서 `db/supabase_schema.sql` 내용을 실행합니다.
3. 로컬과 Vercel에 환경변수를 넣습니다.

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 로컬 테스트 수집

```powershell
python scripts\collectory_crawl.py --region kr --limit-sets 1 --dry-run
```

성공하면 카드 JSON 샘플이 출력됩니다.

## SQLite에 먼저 저장

```powershell
python scripts\collectory_crawl.py --region kr --limit-sets 3
```

결과 파일:

```text
data/collectory.sqlite
```

## Supabase까지 업로드

```powershell
$env:SUPABASE_URL="https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
python scripts\collectory_crawl.py --region kr --limit-sets 3 --supabase
```

## 특정 팩만 찾고 업로드

먼저 후보를 확인합니다.

```powershell
python scripts\collectory_crawl.py --region kr --set-query "메가드림" --list-sets
```

원하는 팩이 보이면 업로드합니다.

```powershell
python scripts\collectory_crawl.py --region kr --set-query "메가드림" --supabase
```

세트 목록에서 검색이 안 잡히지만 Collectory 세트 ID를 알고 있으면 직접 넣을 수 있습니다.

```powershell
python scripts\collectory_crawl.py --region kr --set-id ede55e39-375f-43ba-b325-5a8d3d46cd29 --set-name "MEGA 드림 ex" --set-code BS2025015 --supabase
```

## 전체 한국판 수집

```powershell
python scripts\collectory_crawl.py --region kr --sleep 1.5 --supabase
```

## 주의

Collectory 공개 HTML을 천천히 읽는 방식입니다. `--sleep` 값을 낮추면 차단될 가능성이 커집니다.
