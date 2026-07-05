(function () {
	'use strict';

	// Все настройки теперь хранятся прямо здесь, никаких внешних JSON файлов!
	var remoteConfig = {
		version: '3.0.0',
		max_quality: '720p',
		sports_playlist: 'https://iptv-org.github.io/iptv/countries/ru.m3u',
		mirrors: [
			'https://hdrezka.me',
			'https://rezka.ag',
			'https://kinopub.me',
		],
		trash_codes: ['@_@', '#h', '//_//', '@@', '!!!', '0^0'],
	};

	var currentMirrorIndex = 0;
	function getBaseUrl() {
		return remoteConfig.mirrors[currentMirrorIndex];
	}
	function nextMirror() {
		currentMirrorIndex++;
		if (currentMirrorIndex >= remoteConfig.mirrors.length) {
			currentMirrorIndex = 0;
			return false;
		}
		return true;
	}

	// Кнопка в карточке фильма
	Lampa.Listener.follow('full', function (e) {
		if (e.type == 'complite') {
			var button = $(
				'<div class="full-start__button selector" style="background: #e67e22; border-radius: 0.3em;">' +
					'<span>🔥 HDRezka Pro</span>' +
					'</div>',
			);
			button.on('hover:enter', function () {
				Lampa.Activity.push({
					url: '',
					title: 'HDRezka Pro',
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
	function attachController(self, scroll) {
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
					Lampa.Activity.backward();
				},
			});
			Lampa.Controller.toggle('content');
		};
		self.pause = function () {};
		self.stop = function () {};
	}

	// Компонент HDRezka
	function createRezkaComponent() {
		Lampa.Component.add('rezka_pro', function (object) {
			var comp_network = new Lampa.Reguest();
			var scroll = new Lampa.Scroll({ mask: true, over: true });
			var html = $(
				'<div><div class="rezka-status" style="padding: 2em; text-align: center; font-size: 1.2em; color: #fff;">Searching...</div></div>',
			);

			function setStatus(text) {
				html.find('.rezka-status').text(text);
			}

			this.create = function () {
				currentMirrorIndex = 0;
				searchOnRezka(object.movie.title || object.movie.name, object.movie);
			};

			attachController(this, scroll);

			function searchOnRezka(query, movieData) {
				setStatus('Searching ' + query + ' on ' + getBaseUrl() + '...');
				var url =
					getBaseUrl() +
					'/search/?do=search&subaction=search&q=' +
					encodeURIComponent(query);

				comp_network.silent(
					url,
					function (pageHtml) {
						if (
							pageHtml.includes('Cloudflare') ||
							pageHtml.includes('Just a moment')
						) {
							setStatus('Cloudflare protection. Changing mirror...');
							if (nextMirror()) searchOnRezka(query, movieData);
							else setStatus('All mirrors blocked.');
							return;
						}
						try {
							var parser = new DOMParser();
							var doc = parser.parseFromString(pageHtml, 'text/html');
							var items = doc.querySelectorAll('.b-content__inline_item');
							if (items.length === 0) return setStatus('Not found.');

							var titleElement = items[0].querySelector(
								'.b-content__inline_item-link a',
							);
							if (titleElement) {
								setStatus('Found! Preparing video...');
								getMoviePage(titleElement.href, movieData);
							}
						} catch (err) {
							setStatus('Search parsing error.');
						}
					},
					function () {
						if (nextMirror()) searchOnRezka(query, movieData);
						else setStatus('Mirrors unavailable.');
					},
					false,
					{ dataType: 'text' },
				);
			}

			function getMoviePage(url, movieData) {
				comp_network.silent(
					url,
					function (pageHtml) {
						try {
							var postIdMatch = pageHtml.match(/id="post_id"\s+value="(\d+)"/);
							if (!postIdMatch) throw new Error('post_id not found');
							var postId = postIdMatch[1];

							var savedTranslator = Lampa.Storage.get(
								'rezka_translator_' + postId,
								null,
							);
							var translatorId =
								savedTranslator ||
								(pageHtml.match(/id="translator_id"\s+value="(\d+)"/)
									? pageHtml.match(/id="translator_id"\s+value="(\d+)"/)[1]
									: '1');

							var trashCodes = extractTrashDynamically(pageHtml);
							getVideoStream(postId, translatorId, movieData, trashCodes);
						} catch (err) {
							setStatus('Movie data error.');
						}
					},
					false,
					false,
					{ dataType: 'text' },
				);
			}

			function extractTrashDynamically(pageHtml) {
				var trashList = remoteConfig.trash_codes.slice();
				var scriptBlocks =
					pageHtml.match(/<script.*?>([\s\S]*?)<\/script>/g) || [];
				scriptBlocks.forEach(function (script) {
					if (
						script.includes('join') &&
						script.includes('split') &&
						!script.includes('src=')
					) {
						var matches = script.match(/(["'])(.*?)\1/g);
						if (matches) {
							matches.forEach(function (m) {
								var cleanStr = m.replace(/["']/g, '');
								if (cleanStr.length > 0 && cleanStr.length < 10)
									trashList.push(cleanStr);
							});
						}
					}
				});

				var uniqueTrash = [];
				trashList.forEach(function (item) {
					if (uniqueTrash.indexOf(item) === -1) uniqueTrash.push(item);
				});
				return uniqueTrash;
			}

			function getVideoStream(postId, translatorId, movieData, trashCodes) {
				var isTvShow = movieData.type === 'tv';
				var postData =
					'id=' +
					postId +
					'&translator_id=' +
					translatorId +
					'&action=' +
					(isTvShow ? 'get_episodes' : 'get_movie');

				if (isTvShow) {
					var lastSeason = Lampa.Storage.get('rezka_season_' + postId, 1);
					var lastEpisode = Lampa.Storage.get('rezka_episode_' + postId, 1);
					postData += '&season=' + lastSeason + '&episode=' + lastEpisode;
				}

				comp_network.silent(
					getBaseUrl() + '/ajax/get_play_video/',
					function (response) {
						if (response && response.success && response.url) {
							var qualities = decryptRezkaUrl(response.url, trashCodes);
							if (qualities) {
								setStatus('Ready!');
								playVideo(qualities, movieData);
							} else setStatus('Decryption error.');
						} else setStatus('HDRezka server error.');
					},
					false,
					postData,
					{
						dataType: 'json',
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					},
				);
			}

			function decryptRezkaUrl(encodedString, trashCodes) {
				try {
					var cleanedString = encodedString;
					trashCodes.forEach(function (trash) {
						var regex = new RegExp(
							trash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
							'g',
						);
						cleanedString = cleanedString.replace(regex, '');
					});
					var decodedText = atob(
						cleanedString.replace(/[^A-Za-z0-9+\/=]/g, ''),
					);

					var qualities = {};
					decodedText.split(',').forEach(function (linkInfo) {
						var match = linkInfo.match(/\[(\d+p)\](http.*)/);
						if (match) qualities[match[1]] = match[2].split(' or ')[0];
					});
					return qualities;
				} catch (e) {
					return null;
				}
			}

			function playVideo(qualities, movieData) {
				if (!qualities || Object.keys(qualities).length === 0) return;
				var maxQuality = remoteConfig.max_quality || '720p';
				var selectedUrl =
					qualities[maxQuality] ||
					qualities['720p'] ||
					qualities[Object.keys(qualities)[0]];

				Lampa.Player.play({
					title: movieData.title || movieData.name,
					url: selectedUrl,
					quality: qualities,
					timeline: {
						hash: 'rezka_' + movieData.id,
						title: movieData.title || movieData.name,
					},
				});
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
				if (!remoteConfig.sports_playlist) {
					html.find('.sports-status').text('M3U playlist link is empty.');
					return;
				}
				comp_network.silent(
					remoteConfig.sports_playlist,
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
						'<div class="selector" style="background: #333; padding: 15px; border-radius: 8px; width: 200px; text-align: center; cursor: pointer;">' +
							'<div style="color: #fff; font-weight: bold;">' +
							channel.name +
							'</div>' +
							'</div>',
					);
					item.on('hover:enter', function () {
						Lampa.Player.play({ title: channel.name, url: channel.url });
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

	// Старт
	function startPlugin() {
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
