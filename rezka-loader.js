(function () {
	'use strict';

	// Заглушка-загрузчик: этот файл никогда не меняется, поэтому его можно
	// кешировать вечно. Основной плагин он подгружает с параметром v=время,
	// который заставляет браузер ТВ скачать свежую копию при каждом запуске.
	var url =
		'https://cdn.jsdelivr.net/gh/VladimirRiz/lampa-plugins@main/rezka-plugin.js';

	var script = document.createElement('script');
	script.src = url + '?v=' + Date.now();
	document.head.appendChild(script);
})();
