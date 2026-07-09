# Свой Lampac-хост для Online Pro

Зачем: сейчас плагин работает через чужой сервер `beta.mitsu.tv` — он может
умереть, включить регистрацию или остаться без нужного источника (rezka там,
например, отключена). Свой Lampac закрывает все три риска: сервер ваш,
источники включаете сами.

Lampac — открытый проект: <https://github.com/lampac-nextgen/lampac>.
Это backend на ASP.NET Core, который агрегирует 70+ источников и отдаёт их
JSON API — ровно тот протокол, по которому уже работает наш плагин.

---

## Шаг 1. Арендовать VPS

Подойдёт самый дешёвый тариф (~5 $/мес):

- 1–2 CPU, 2 ГБ RAM, 20 ГБ диска;
- Ubuntu 22.04/24.04;
- локация: Европа обычно ок. Если какой-то источник не будет отвечать
  с зарубежного IP, в Lampac включается прокси per-источник в `init.conf`.

После покупки у вас будет IP сервера и root-доступ по SSH:

```bash
ssh root@ВАШ_IP
```

## Шаг 2. Поставить Docker

```bash
curl -fsSL https://get.docker.com | sh
```

## Шаг 3. Установить Lampac

Вариант A — Docker Compose (рекомендую, проще обновлять):

```bash
git clone https://github.com/lampac-nextgen/lampac.git
cd lampac
mkdir -p lampac-docker/config lampac-docker/plugins
cp config/example.init.conf lampac-docker/config/init.conf
printf '%s' 'ВАШ_ПАРОЛЬ_АДМИНА' > lampac-docker/config/passwd
docker compose up -d
```

Важно: чтобы контейнер использовал ваши `init.conf` и `passwd`,
раскомментируйте секцию `volumes` в `docker-compose.yaml` (по умолчанию
она закомментирована и контейнер стартует со встроенным конфигом).

Вариант B — установка прямо на систему одной командой:

```bash
curl -fsSL https://raw.githubusercontent.com/lampac-nextgen/lampac/main/install.sh | sudo bash
```

Обновление в варианте B:

```bash
curl -fsSL https://raw.githubusercontent.com/lampac-nextgen/lampac/main/install.sh | sudo bash -s -- --update
```

Сервер слушает порт **9118**.

## Шаг 4. Включить нужные источники

Откройте `lampac-docker/config/init.conf` (вариант A) или `init.conf` рядом
с исполняемым файлом (вариант B) и включите источники по образцу:

```json
{
  "Rezka":  { "enable": true, "host": "https://rezka.ag", "priority": 1 },
  "Filmix": { "enable": true }
}
```

- `"enable": true/false` — включить/выключить источник;
- конфиг перечитывается автоматически каждую секунду, рестарт не нужен;
- полный список опций смотрите в `config/example.init.conf` вашей версии.

## Шаг 5. Проверить

С любого компьютера откройте в браузере:

```
http://ВАШ_IP:9118/lite/events?title=Интерстеллар&year=2014&serial=0
```

Должен вернуться JSON со списком включённых источников. Если пусто —
смотрите логи: `docker compose logs -f` (вариант A).

## Шаг 6. Подключить к плагину

На телевизоре: **Настройки → Online Pro → Lampac сервер** → ввести

```
http://ВАШ_IP:9118
```

Больше ничего менять не надо — плагин сам строит пути `/lite/...`.
Если ваш хост недоступен, плагин автоматически откатится на встроенный
запасной (`beta.mitsu.tv`).

---

## Опционально, но желательно

**Файрвол.** Откройте наружу только SSH и порт Lampac:

```bash
ufw allow 22/tcp && ufw allow 9118/tcp && ufw enable
```

**Не раздавайте адрес сервера.** API открытый: любой, кто узнает
`IP:9118`, сможет им пользоваться и создавать вам нагрузку. Механизмы
ограничения доступа (accsdb/пароль) описаны в `example.init.conf`.

**Домен и HTTPS.** Приложениям Lampa на ТВ достаточно `http://IP:9118`.
HTTPS понадобится, только если пользуетесь браузерной Lampa с https-сайта:
тогда либо nginx + certbot, либо бесплатный прокси Cloudflare перед
сервером.

**Автозапуск.** В варианте A compose уже поднимает контейнер после
перезагрузки (`restart: always` в `docker-compose.yaml` — проверьте, что
строка не закомментирована).
