(function () {
	'use strict';

	// Вся тяжёлая работа (парсинг источников, обход защит, зеркала) делается
	// на сервере Lampac. Клиент только ходит по его JSON API (rjson=true).
	var config = {
		version: '4.3.0',
		// Запасные хосты: пробуются по порядку, хост из настроек — первым
		hosts: ['https://beta.mitsu.tv/api'],
		sports_playlist: 'https://iptv-org.github.io/iptv/countries/ru.m3u',
	};

	function hostList() {
		var list = [];
		var saved = String(Lampa.Storage.get('rezka_pro_host', '') || '')
			.trim()
			.replace(/\/+$/, '');
		if (saved) list.push(saved);
		config.hosts.forEach(function (h) {
			if (list.indexOf(h) === -1) list.push(h);
		});
		return list;
	}

	// Тип удалённой проверки (rch), если на клиенте загружен её обработчик —
	// без этого параметра часть балансеров молча возвращает пустоту
	function rchType(host) {
		var hostkey = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
		if (window.rch_nws && window.rch_nws[hostkey])
			return window.rch_nws[hostkey].type || '';
		if (window.rch && window.rch[hostkey]) return window.rch[hostkey].type || '';
		return '';
	}

	// Подсветка выбранного пультом элемента (Lampa вешает класс .focus)
	function injectStyles() {
		if ($('style[data-rezka-pro]').length) return;
		$('body').append(
			'<style data-rezka-pro>' +
				'.rezka-item.focus { background: #e67e22 !important; box-shadow: 0 0 0 0.15em #fff; transform: scale(1.01); }' +
				'.rezka-item.focus div { color: #fff !important; }' +
				'.rezka-voice.focus { box-shadow: 0 0 0 0.2em #fff; }' +
				'.rezka-badge { display: inline-block; margin-left: 0.6em; padding: 0 0.4em; border-radius: 0.2em; background: #e67e22; color: #fff; font-size: 0.75em; vertical-align: middle; }' +
				'.rezka-item .time-line { margin-top: 0.6em; }' +
				'.rezka-spinner { width: 2em; height: 2em; margin: 2em auto 0; border: 0.25em solid rgba(255,255,255,0.3); border-top-color: #e67e22; border-radius: 50%; animation: rezka-spin 0.8s linear infinite; }' +
				'@keyframes rezka-spin { to { transform: rotate(360deg); } }' +
				'</style>',
		);
	}

	function addRjson(url) {
		if (url.indexOf('rjson=') >= 0) return url;
		return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'rjson=true';
	}

	// Кнопка в карточке фильма
	Lampa.Listener.follow('full', function (e) {
		if (e.type == 'complite') {
			var button = $(
				'<div class="full-start__button selector" style="background: #e67e22; border-radius: 0.3em;">' +
					'<span>🔥 Online Pro</span>' +
					'</div>',
			);
			button.on('hover:enter', function () {
				Lampa.Activity.push({
					url: '',
					title: 'Online Pro',
					component: 'rezka_pro',
					movie: e.data.movie,
					page: 1,
				});
			});
			var render = e.object.activity.render();
			var container = render.find('.full-start-new__buttons');
			if (!container.length) container = render.find('.full-start__buttons');
			container.append(button);
		}
	});

	// Управление пультом для компонентов (обязательные методы start/pause/stop)
	function attachController(self, scroll, onBack, files) {
		self.start = function () {
			Lampa.Controller.add('content', {
				toggle: function () {
					Lampa.Controller.collectionSet(
						scroll.render(),
						files ? files.render() : null,
					);
					Lampa.Controller.collectionFocus(false, scroll.render());
				},
				up: function () {
					if (Navigator.canmove('up')) Navigator.move('up');
					else Lampa.Controller.toggle('head');
				},
				down: function () {
					if (Navigator.canmove('down')) Navigator.move('down');
				},
				left: function () {
					if (Navigator.canmove('left')) Navigator.move('left');
					else Lampa.Controller.toggle('menu');
				},
				right: function () {
					if (Navigator.canmove('right')) Navigator.move('right');
				},
				back: function () {
					if (onBack && onBack()) return;
					Lampa.Activity.backward();
				},
			});
			Lampa.Controller.toggle('content');
		};
		self.pause = function () {};
		self.stop = function () {};
	}

	// Компонент онлайн-просмотра через Lampac
	function createRezkaComponent() {
		Lampa.Component.add('rezka_pro', function (object) {
			var network = new Lampa.Reguest();
			var scroll = new Lampa.Scroll({ mask: true, over: true });
			// Explorer даёт списку каркас с ограниченной высотой — без него
			// контейнер растягивается и скроллу нечего прокручивать
			var files = new Lampa.Explorer(object);
			var html = $('<div class="rezka-list" style="padding: 1em;"></div>');
			var movie = object.movie;
			// Стек уровней навигации: источники → сезоны → серии
			var history = [];
			var hosts = hostList();
			var hostIndex = 0;

			function currentHost() {
				return hosts[hostIndex];
			}

			function setStatus(text, spinner) {
				html.empty();
				if (spinner) html.append('<div class="rezka-spinner"></div>');
				html.append(
					$(
						'<div style="padding: 2em; text-align: center; font-size: 1.2em; color: #fff;"></div>',
					).text(text),
				);
			}

			// Сообщение + кнопка возврата к списку источников, доступная с пульта
			function showMessage(text) {
				html.empty();
				html.append(
					$(
						'<div style="padding: 1.5em; text-align: center; font-size: 1.1em; color: #fff;"></div>',
					).text(text),
				);
				var back = $(
					'<div class="selector rezka-item" style="background: #2a2a2a; margin: 0 auto; padding: 1em; border-radius: 0.4em; max-width: 20em; text-align: center;">' +
						'<div style="color: #fff; font-weight: bold;">← К списку источников</div>' +
						'</div>',
				);
				back.on('hover:enter', function () {
					resetToSources();
				});
				back.on('hover:focus', focusFollow);
				html.append(back);
				Lampa.Controller.toggle('content');
				scroll.update(html, true);
			}

			function resetToSources() {
				if (history.length) {
					history = [history[0]];
					renderJson(history[0]);
				} else loadStart();
			}

			function focusFollow(e) {
				scroll.update($(e.target), true);
			}

			function queryParams() {
				var q = [];
				q.push('id=' + encodeURIComponent(movie.id || ''));
				q.push('title=' + encodeURIComponent(movie.title || movie.name || ''));
				q.push(
					'original_title=' +
						encodeURIComponent(movie.original_title || movie.original_name || ''),
				);
				q.push('serial=' + (movie.name ? 1 : 0));
				q.push(
					'year=' +
						String(movie.release_date || movie.first_air_date || '0000').slice(0, 4),
				);
				if (movie.imdb_id) q.push('imdb_id=' + encodeURIComponent(movie.imdb_id));
				if (movie.kinopoisk_id)
					q.push('kinopoisk_id=' + encodeURIComponent(movie.kinopoisk_id));
				q.push('rchtype=' + encodeURIComponent(rchType(currentHost())));
				return q.join('&');
			}

			// Стандартный для Lampa хеш прогресса: у сериалов по сезону/серии,
			// у фильмов по оригинальному названию — синхронизируется с другими
			// онлайн-плагинами
			function timelineFor(item) {
				var name = movie.original_title || movie.title || movie.name || '';
				var hash = item.s
					? Lampa.Utils.hash([item.s, item.e || 0, name].join(''))
					: Lampa.Utils.hash(name);
				return Lampa.Timeline.view(hash);
			}

			function qualityLabel(item) {
				var q = item.quality;
				if (typeof q === 'string') return q;
				if (q && typeof q === 'object') {
					var keys = Object.keys(q);
					if (keys.length) return keys[0];
				}
				return item.maxquality || item.quality_str || '';
			}

			this.create = function () {
				scroll.body().addClass('torrent-list');
				scroll.append(html);
				files.appendFiles(scroll.render());
				scroll.minus(files.render().find('.explorer__files-head'));
				loadStart();
			};

			// Первый уровень: список доступных источников с сервера Lampac.
			// Запомненный источник открывается сразу, список остаётся на «назад»
			function loadStart() {
				setStatus('Загрузка источников с ' + currentHost() + '...', true);
				network.silent(
					currentHost() + '/lite/events?' + queryParams(),
					function (sources) {
						if (!sources || !sources.length) {
							setStatus('Сервер не вернул ни одного источника.');
							return;
						}
						var saved = Lampa.Storage.get('rezka_pro_source', '');
						var savedItem = null;
						var json = {
							type: 'sources',
							data: sources.map(function (s) {
								var item = {
									method: 'link',
									balanser: s.balanser,
									name:
										String(s.name || s.balanser).replace(/<[^>]+>/g, '') +
										(s.balanser === saved ? ' ✓' : ''),
									url: s.url + '?' + queryParams(),
								};
								if (s.balanser === saved) savedItem = item;
								return item;
							}),
						};
						history.push(json);
						if (savedItem) load(savedItem.url, true);
						else renderJson(json);
					},
					function () {
						if (hostIndex < hosts.length - 1) {
							hostIndex++;
							loadStart();
						} else setStatus('Серверы недоступны: ' + hosts.join(', '));
					},
					false,
					{ dataType: 'json' },
				);
			}

			function load(url, pushHistory) {
				setStatus('Загрузка...', true);
				network.silent(
					addRjson(url),
					function (json) {
						if (pushHistory) history.push(json);
						renderJson(json);
					},
					function () {
						showMessage('Ошибка загрузки. Попробуйте другой источник.');
					},
					false,
					{ dataType: 'json' },
				);
			}

			function renderJson(json) {
				var items = json && (json.data || json.episodes || []);
				if (!json || !items.length) {
					showMessage('Источник ничего не вернул. Попробуйте другой.');
					return;
				}
				html.empty();

				// Переключение озвучки
				if (json.voice && json.voice.length) {
					var voiceRow = $(
						'<div style="display: flex; flex-wrap: wrap; gap: 0.5em; margin-bottom: 1em;"></div>',
					);
					json.voice.forEach(function (v) {
						var vbtn = $(
							'<div class="selector rezka-voice" style="padding: 0.4em 0.8em; border-radius: 0.3em; background: ' +
								(v.active ? '#e67e22' : '#333') +
								'; color: #fff;"></div>',
						).text(v.name);
						vbtn.on('hover:enter', function () {
							history.pop();
							load(v.url, true);
						});
						vbtn.on('hover:focus', focusFollow);
						voiceRow.append(vbtn);
					});
					html.append(voiceRow);
				}

				items.forEach(function (item) {
					var label =
						item.title || item.name || (item.translate ? item.translate : '???');
					var quality = qualityLabel(item);
					var detailParts = [];
					if (item.translate || item.voice_name)
						detailParts.push(item.translate || item.voice_name);
					if (quality) detailParts.push(quality);
					var details = item.details || item.info || detailParts.join(' · ');

					var row = $(
						'<div class="selector rezka-item" style="background: #2a2a2a; margin-bottom: 0.5em; padding: 1em; border-radius: 0.4em;">' +
							'<div style="color: #fff; font-weight: bold;"></div>' +
							'<div style="color: #aaa; font-size: 0.9em;"></div>' +
							'</div>',
					);
					var titleEl = row.children().first();
					titleEl.text(label);
					if (/2160|4k/i.test(quality))
						titleEl.append('<span class="rezka-badge">4K</span>');
					else if (/1440|2k/i.test(quality))
						titleEl.append('<span class="rezka-badge">2K</span>');
					if (details) row.children().last().text(details);
					else row.children().last().remove();

					// Полоска прогресса просмотра на сериях и фильмах
					if (item.method != 'link') {
						try {
							row.append(Lampa.Timeline.render(timelineFor(item)));
						} catch (e) {}
					}

					row.on('hover:enter', function () {
						if (item.method == 'link') {
							if (item.balanser)
								Lampa.Storage.set('rezka_pro_source', item.balanser);
							load(item.url, true);
						} else playItem(item, items);
					});
					row.on('hover:focus', focusFollow);
					html.append(row);
				});

				Lampa.Controller.toggle('content');
				scroll.update(html, true);
			}

			function videoFor(item) {
				return {
					title:
						(movie.title || movie.name) +
						(item.e ? ' / ' + (item.name || 'Серия ' + item.e) : ''),
					url: item.url,
					quality: item.quality,
					subtitles: item.subtitles,
					timeline: timelineFor(item),
				};
			}

			function startPlayer(item, siblings) {
				Lampa.Player.play(videoFor(item));
				// Плейлист сезона: в плеере работают кнопки след./пред. серия
				if (siblings && siblings.length > 1) {
					var playlist = [];
					siblings.forEach(function (m) {
						if (m.method == 'play') playlist.push(videoFor(m));
					});
					if (playlist.length > 1) Lampa.Player.playlist(playlist);
				}
			}

			function playItem(item, siblings) {
				if (item.method == 'play') {
					startPlayer(item, siblings);
				} else {
					// method == 'call': ещё один запрос за финальной ссылкой
					setStatus('Получение видео...', true);
					network.silent(
						addRjson(item.url),
						function (json) {
							var last = history[history.length - 1];
							if (last) renderJson(last);
							if (json && json.url) {
								json.title = json.title || item.title || item.name;
								json.s = item.s;
								json.e = item.e;
								startPlayer(json);
							} else Lampa.Noty.show('Не удалось получить ссылку на видео.');
						},
						function () {
							Lampa.Noty.show('Ошибка запроса видео.');
						},
						false,
						{ dataType: 'json' },
					);
				}
			}

			attachController(
				this,
				scroll,
				function () {
					// Назад по уровням: серии → сезоны → источники
					if (history.length > 1) {
						history.pop();
						renderJson(history[history.length - 1]);
						return true;
					}
					return false;
				},
				files,
			);

			this.render = function () {
				return files.render();
			};
			this.destroy = function () {
				network.clear();
				scroll.destroy();
				files.destroy();
				html.empty();
				html.remove();
			};
		});
	}

	// Компонент Спорт ТВ
	function injectSportsMenu() {
		var menuItem = $(
			'<li class="menu__item selector"><div class="menu__ico">⚽</div><div class="menu__text">Sport TV</div></li>',
		);
		menuItem.on('hover:enter', function () {
			Lampa.Activity.push({
				url: '',
				title: 'Sports Live',
				component: 'sports_tv_pro',
				page: 1,
			});
		});
		setTimeout(function () {
			$('.menu .menu__list').append(menuItem);
		}, 1000);
	}

	function createSportsComponent() {
		Lampa.Component.add('sports_tv_pro', function (object) {
			var network = new Lampa.Reguest();
			var scroll = new Lampa.Scroll({ mask: true, over: true });
			var files = null;
			// У этого экрана нет карточки фильма — подставляем заголовок,
			// а если Explorer не взлетит, работаем без каркаса
			try {
				object.movie = object.movie || { title: 'Sport TV' };
				files = new Lampa.Explorer(object);
			} catch (e) {}
			var html = $('<div style="padding: 1em;"></div>');
			var allGroups = [];
			var openedGroup = null;

			function setStatus(text, spinner) {
				html.empty();
				if (spinner) html.append('<div class="rezka-spinner"></div>');
				html.append(
					$(
						'<div style="padding: 2em; text-align: center; color: #fff;"></div>',
					).text(text),
				);
			}

			function focusFollow(e) {
				scroll.update($(e.target), true);
			}

			this.create = function () {
				scroll.body().addClass('torrent-list');
				scroll.append(html);
				if (files) {
					files.appendFiles(scroll.render());
					scroll.minus(files.render().find('.explorer__files-head'));
				}
				if (!config.sports_playlist) {
					setStatus('Ссылка на M3U плейлист пуста.');
					return;
				}
				setStatus('Загрузка плейлиста...', true);
				network.silent(
					config.sports_playlist,
					function (m3uData) {
						var channels = parseM3U(m3uData);
						if (!channels.length) {
							setStatus('Плейлист пуст.');
							return;
						}
						allGroups = groupChannels(channels);
						renderGroups();
					},
					function () {
						setStatus('Не удалось скачать плейлист.');
					},
					false,
					{ dataType: 'text' },
				);
			};

			function parseM3U(data) {
				var channels = [];
				var lines = data.split('\n');
				var current = null;
				for (var i = 0; i < lines.length; i++) {
					var line = lines[i].trim();
					if (line.indexOf('#EXTINF') === 0) {
						current = {};
						var nameMatch = line.match(/,(.+)$/);
						current.name = nameMatch ? nameMatch[1].trim() : 'Без названия';
						var logoMatch = line.match(/tvg-logo="([^"]*)"/);
						if (logoMatch && logoMatch[1]) current.logo = logoMatch[1];
						var groupMatch = line.match(/group-title="([^"]*)"/);
						current.group =
							groupMatch && groupMatch[1] ? groupMatch[1] : 'Без группы';
					} else if (line.indexOf('http') === 0 && current) {
						current.url = line;
						channels.push(current);
						current = null;
					}
				}
				return channels;
			}

			function groupChannels(channels) {
				var map = {};
				var order = [];
				channels.forEach(function (c) {
					if (!map[c.group]) {
						map[c.group] = [];
						order.push(c.group);
					}
					map[c.group].push(c);
				});
				return order.map(function (name) {
					return { name: name, channels: map[name] };
				});
			}

			function renderGroups() {
				openedGroup = null;
				html.empty();
				allGroups.forEach(function (group) {
					var row = $(
						'<div class="selector rezka-item" style="background: #2a2a2a; margin-bottom: 0.5em; padding: 1em; border-radius: 0.4em;">' +
							'<div style="color: #fff; font-weight: bold;"></div>' +
							'<div style="color: #aaa; font-size: 0.9em;"></div>' +
							'</div>',
					);
					row.children().first().text(group.name);
					row.children().last().text('Каналов: ' + group.channels.length);
					row.on('hover:enter', function () {
						renderChannels(group);
					});
					row.on('hover:focus', focusFollow);
					html.append(row);
				});
				Lampa.Controller.toggle('content');
				scroll.update(html, true);
			}

			function renderChannels(group) {
				openedGroup = group;
				html.empty();
				group.channels.forEach(function (channel) {
					var row = $(
						'<div class="selector rezka-item" style="background: #2a2a2a; margin-bottom: 0.5em; padding: 0.8em 1em; border-radius: 0.4em; display: flex; align-items: center;">' +
							'<div style="color: #fff; font-weight: bold;"></div>' +
							'</div>',
					);
					if (channel.logo) {
						var logo = $(
							'<img style="width: 2.2em; height: 2.2em; object-fit: contain; margin-right: 0.8em;" loading="lazy">',
						);
						logo.attr('src', channel.logo);
						logo.on('error', function () {
							logo.remove();
						});
						row.prepend(logo);
					}
					row.children().last().text(channel.name);
					row.on('hover:enter', function () {
						Lampa.Player.play({ title: channel.name, url: channel.url });
					});
					row.on('hover:focus', focusFollow);
					html.append(row);
				});
				Lampa.Controller.toggle('content');
				scroll.update(html, true);
			}

			attachController(
				this,
				scroll,
				function () {
					// Назад из списка каналов — к группам
					if (openedGroup) {
						renderGroups();
						return true;
					}
					return false;
				},
				files,
			);

			this.render = function () {
				return files ? files.render() : scroll.render();
			};
			this.destroy = function () {
				network.clear();
				scroll.destroy();
				if (files) files.destroy();
				html.empty();
				html.remove();
			};
		});
	}

	// Настройки в меню Lampa: адрес сервера и сброс запомненного источника
	function addSettings() {
		if (!Lampa.SettingsApi) return;
		Lampa.SettingsApi.addComponent({
			component: 'rezka_pro',
			name: 'Online Pro',
			icon:
				'<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
				'<path d="M4 4h16v12H4z" stroke="currentColor" stroke-width="2"/>' +
				'<path d="M10 8l4 2-4 2V8z" fill="currentColor"/>' +
				'<path d="M8 20h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
				'</svg>',
		});
		Lampa.SettingsApi.addParam({
			component: 'rezka_pro',
			param: {
				name: 'rezka_pro_host',
				type: 'input',
				values: '',
				default: config.hosts[0],
			},
			field: {
				name: 'Lampac сервер',
				description: 'Адрес API, например ' + config.hosts[0],
			},
		});
		Lampa.SettingsApi.addParam({
			component: 'rezka_pro',
			param: { name: 'rezka_pro_reset_source', type: 'button' },
			field: {
				name: 'Сбросить запомненный источник',
				description: 'Снова показывать список источников при открытии',
			},
			onChange: function () {
				Lampa.Storage.set('rezka_pro_source', '');
				Lampa.Noty.show('Источник сброшен');
			},
		});
	}

	// Чистка ключей Storage, оставшихся от старой скрейпинг-версии (до 4.0.0)
	function cleanupLegacyStorage() {
		try {
			var prefixes = ['rezka_translator_', 'rezka_season_', 'rezka_episode_'];
			for (var i = localStorage.length - 1; i >= 0; i--) {
				var key = localStorage.key(i);
				if (
					key &&
					prefixes.some(function (p) {
						return key.indexOf(p) === 0;
					})
				) {
					localStorage.removeItem(key);
				}
			}
		} catch (e) {}
	}

	// Старт
	function startPlugin() {
		injectStyles();
		cleanupLegacyStorage();
		addSettings();
		createRezkaComponent();
		createSportsComponent();
		injectSportsMenu();
	}

	if (window.appready) startPlugin();
	else
		Lampa.Listener.follow('app', function (e) {
			if (e.type == 'ready') startPlugin();
		});
})();
