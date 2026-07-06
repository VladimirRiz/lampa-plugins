(function () {
	'use strict';

	// Вся тяжёлая работа (парсинг HDRezka, обход защит, зеркала) делается
	// на сервере Lampac. Клиент только ходит по его JSON API (rjson=true).
	var config = {
		version: '4.2.2',
		host: 'https://beta.mitsu.tv/api',
		sports_playlist: 'https://iptv-org.github.io/iptv/countries/ru.m3u',
	};

	// Подсветка выбранного пультом элемента (Lampa вешает класс .focus)
	function injectStyles() {
		if ($('style[data-rezka-pro]').length) return;
		$('body').append(
			'<style data-rezka-pro>' +
				'.rezka-item.focus { background: #e67e22 !important; box-shadow: 0 0 0 0.15em #fff; transform: scale(1.01); }' +
				'.rezka-item.focus div { color: #fff !important; }' +
				'.rezka-voice.focus { box-shadow: 0 0 0 0.2em #fff; }' +
				'.rezka-channel.focus { background: #e67e22 !important; box-shadow: 0 0 0 0.15em #fff; }' +
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
	function attachController(self, scroll, onBack) {
		self.start = function () {
			Lampa.Controller.add('content', {
				toggle: function () {
					Lampa.Controller.collectionSet(scroll.render());
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

	// Компонент HDRezka через Lampac
	function createRezkaComponent() {
		Lampa.Component.add('rezka_pro', function (object) {
			var network = new Lampa.Reguest();
			var scroll = new Lampa.Scroll({ mask: true, over: true });
			var html = $('<div class="rezka-list" style="padding: 1em;"></div>');
			var movie = object.movie;
			// Стек уровней навигации: похожие → сезоны → серии
			var history = [];

			function setStatus(text) {
				html.empty().append(
					$(
						'<div style="padding: 2em; text-align: center; font-size: 1.2em; color: #fff;"></div>',
					).text(text),
				);
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
				return q.join('&');
			}

			this.create = function () {
				loadStart();
			};

			// Первый уровень: список доступных источников с сервера Lampac
			function loadStart() {
				setStatus('Загрузка источников с ' + config.host + '...');
				network.silent(
					config.host + '/lite/events?' + queryParams(),
					function (sources) {
						if (!sources || !sources.length) {
							setStatus('Нет доступных источников.');
							return;
						}
						var json = {
							type: 'sources',
							data: sources.map(function (s) {
								return {
									method: 'link',
									name: String(s.name || s.balanser).replace(/<[^>]+>/g, ''),
									url: s.url + '?' + queryParams(),
								};
							}),
						};
						history.push(json);
						renderJson(json);
					},
					function () {
						setStatus('Сервер ' + config.host + ' недоступен.');
					},
					false,
					{ dataType: 'json' },
				);
			}

			function load(url, pushHistory) {
				network.silent(
					addRjson(url),
					function (json) {
						if (pushHistory) history.push(json);
						renderJson(json);
					},
					function () {
						setStatus('Ошибка загрузки.');
					},
					false,
					{ dataType: 'json' },
				);
			}

			function renderJson(json) {
				var items = json && (json.data || json.episodes || []);
				if (!json || !items.length) {
					setStatus('Ничего не найдено.');
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
						vbtn.on('hover:focus', function (e) {
							scroll.update($(e.target), true);
						});
						voiceRow.append(vbtn);
					});
					html.append(voiceRow);
				}

				items.forEach(function (item) {
					var label =
						item.title || item.name || (item.translate ? item.translate : '???');
					var details = item.details || item.info || item.quality_str || '';
					var row = $(
						'<div class="selector rezka-item" style="background: #2a2a2a; margin-bottom: 0.5em; padding: 1em; border-radius: 0.4em;">' +
							'<div style="color: #fff; font-weight: bold;"></div>' +
							'<div style="color: #aaa; font-size: 0.9em;"></div>' +
							'</div>',
					);
					row.children().first().text(label);
					if (details) row.children().last().text(details);
					else row.children().last().remove();

					row.on('hover:enter', function () {
						if (item.method == 'link') load(item.url, true);
						else playItem(item);
					});
					row.on('hover:focus', function (e) {
						scroll.update($(e.target), true);
					});
					html.append(row);
				});

				Lampa.Controller.toggle('content');
				scroll.update(html, true);
			}

			function playItem(item) {
				if (item.method == 'play') {
					startPlayer(item);
				} else {
					// method == 'call': ещё один запрос за финальной ссылкой
					setStatus('Получение видео...');
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

			function startPlayer(item) {
				var hash = [movie.id, item.s || 0, item.e || 0].join('_');
				Lampa.Player.play({
					title:
						(movie.title || movie.name) +
						(item.e ? ' / ' + (item.name || 'Серия ' + item.e) : ''),
					url: item.url,
					quality: item.quality,
					subtitles: item.subtitles,
					timeline: {
						hash: 'rezka_' + hash,
						title: movie.title || movie.name,
					},
				});
			}

			attachController(this, scroll, function () {
				// Назад по уровням: серии → сезоны → похожие
				if (history.length > 1) {
					history.pop();
					renderJson(history[history.length - 1]);
					return true;
				}
				return false;
			});

			this.render = function () {
				scroll.append(html);
				return scroll.render();
			};
			this.destroy = function () {
				network.clear();
				scroll.destroy();
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
			var comp_network = new Lampa.Reguest();
			var scroll = new Lampa.Scroll({ mask: true, over: true });
			var html = $(
				'<div><div class="sports-status" style="padding: 2em; text-align: center; color: #fff;">Loading playlist...</div><div class="sports-grid" style="display: flex; flex-wrap: wrap; gap: 10px; padding: 10px;"></div></div>',
			);

			this.create = function () {
				if (!config.sports_playlist) {
					html.find('.sports-status').text('M3U playlist link is empty.');
					return;
				}
				comp_network.silent(
					config.sports_playlist,
					function (m3uData) {
						html.find('.sports-status').remove();
						var channels = parseM3U(m3uData);
						renderChannels(channels);
					},
					function () {
						html.find('.sports-status').text('Failed to download playlist.');
					},
					false,
					{ dataType: 'text' },
				);
			};

			attachController(this, scroll);

			function parseM3U(data) {
				var channels = [];
				var lines = data.split('\n');
				var currentChannel = {};
				for (var i = 0; i < lines.length; i++) {
					var line = lines[i].trim();
					if (line.startsWith('#EXTINF')) {
						var nameMatch = line.match(/,(.+)$/);
						currentChannel.name = nameMatch
							? nameMatch[1].trim()
							: 'Unknown channel';
					} else if (line.startsWith('http')) {
						currentChannel.url = line;
						channels.push(currentChannel);
						currentChannel = {};
					}
				}
				return channels;
			}

			function renderChannels(channels) {
				var grid = html.find('.sports-grid');
				channels.forEach(function (channel) {
					var item = $(
						'<div class="selector rezka-channel" style="background: #333; padding: 15px; border-radius: 8px; width: 200px; text-align: center; cursor: pointer;">' +
							'<div style="color: #fff; font-weight: bold;"></div>' +
							'</div>',
					);
					item.children().first().text(channel.name);
					item.on('hover:enter', function () {
						Lampa.Player.play({ title: channel.name, url: channel.url });
					});
					item.on('hover:focus', function (e) {
						scroll.update($(e.target), true);
					});
					grid.append(item);
				});
				Lampa.Controller.toggle('content');
			}

			this.render = function () {
				scroll.append(html);
				return scroll.render();
			};
			this.destroy = function () {
				comp_network.clear();
				scroll.destroy();
				html.empty();
				html.remove();
			};
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
