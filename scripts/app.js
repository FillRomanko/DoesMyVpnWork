let deferredPrompt = null;
let isInstalled = false;

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('scripts/worker.js').then(reg => {
        // Проверка обновлений при каждой загрузке
        reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    showUpdateNotification();
                }
            });
        });
    }).catch(console.error);

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            window.location.reload();
        }
    });
}

function showUpdateNotification() {
    const banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.innerHTML = `
        Доступна новая версия. 
        <button onclick="window.location.reload()">Обновить</button>
    `;
    document.body.prepend(banner);
}


let sitesData = null;

document.addEventListener('DOMContentLoaded', async () => {
    const sunIcon = `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2V4M12 20V22M4 12H2M6.31412 6.31412L4.8999 4.8999M17.6859 6.31412L19.1001 4.8999M6.31412 17.69L4.8999 19.1042M17.6859 17.69L19.1001 19.1042M22 12H20M17 12C17 14.7614 14.7614 17 12 17C9.23858 17 7 14.7614 7 12C7 9.23858 9.23858 7 12 7C14.7614 7 17 9.23858 17 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const moonIcon = `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 15.8442C20.6866 16.4382 19.2286 16.7688 17.6935 16.7688C11.9153 16.7688 7.23116 12.0847 7.23116 6.30654C7.23116 4.77135 7.5618 3.3134 8.15577 2C4.52576 3.64163 2 7.2947 2 11.5377C2 17.3159 6.68414 22 12.4623 22C16.7053 22 20.3584 19.4742 22 15.8442Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`


    const html = document.documentElement;
    const btnTheme = document.querySelector('[data-js="theme-toggler"]');
    let currentTheme = localStorage.getItem('theme') || 'dark';
    html.setAttribute('data-theme', currentTheme);
    btnTheme.innerHTML = currentTheme === 'light' ? moonIcon : sunIcon;
    btnTheme.addEventListener( "click", () => {
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        btnTheme.innerHTML = newTheme === 'light' ? moonIcon : sunIcon;
        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        currentTheme = newTheme;
    });

    try {
        const response = await fetch('data/sites.json');
        sitesData = await response.json();
    } catch (e) {
        console.error('Не удалось загрузить sites.json', e);
        // Можно показать сообщение пользователю
        return;
    }


    const btnStartTest = document.querySelector('[data-js="start-test"]');
    const testContainer = document.querySelector('[data-js="test-container"]');

    let testRunning = false;
    let currentResults = null;

    btnStartTest.addEventListener('click', async () => {
        if (testRunning) return;
        testRunning = true;
        btnStartTest.style.display = 'none';
        testContainer.innerHTML = '';

        const categories = ['internet', 'white', 'normal', 'vpn'];
        const categoryRows = {};

        // 1. Создаём строки для каждой категории с 5 прямоугольниками
        categories.forEach(cat => {
            const row = document.createElement('div');
            row.className = 'row';
            row.dataset.category = cat;

            // Контейнер для 5 прямоугольников
            const rectsContainer = document.createElement('div');
            rectsContainer.className = 'rects-container';
            const rects = [];
            for (let i = 0; i < 5; i++) {
                const rect = document.createElement('div');
                rect.className = `rect ${cat}`;
                rect.style.setProperty('--fill-percent', '0%');
                rectsContainer.appendChild(rect);
                rects.push(rect);
            }
            row.appendChild(rectsContainer);

            // Статистика
            const statsSpan = document.createElement('span');
            statsSpan.className = 'stats';
            statsSpan.textContent = `[0/0/${sitesData[cat].length}]`;

            const infoIcon = document.createElement('span');
            infoIcon.className = 'info-icon';
            infoIcon.setAttribute('data-tooltip', 'успешно загруженные сайты / попыток загрузить сайты / всего сайтов в библиотеке');
            infoIcon.textContent = 'ⓘ';

            const tooltip = document.createElement('span');
            tooltip.className = 'tooltip';
            tooltip.setAttribute('data-tooltip', 'успешно загруженные сайты / попыток загрузить сайты / всего сайтов в библиотеке');
            tooltip.appendChild(statsSpan);
            row.appendChild(tooltip);

            // Обёртка для статистики и иконки (чтобы они были рядом)
            const statsWrapper = document.createElement('span');
            statsWrapper.className = 'stats-wrapper';
            statsWrapper.appendChild(statsSpan);
            statsWrapper.appendChild(infoIcon);

            row.appendChild(statsWrapper);

            testContainer.appendChild(row);

            categoryRows[cat] = {
                rects,
                statsSpan,
                attempts: 0,
                success: 0,
                total: sitesData[cat].length
            };
        });

        // 2. Элемент для вывода статуса
        const statusDiv = document.createElement('div');
        statusDiv.className = 'status';
        testContainer.appendChild(statusDiv);

        let installBtn = null;

        // 3. Кнопка повтора (скрыта до окончания)
        const retryBtn = document.createElement('button');
        retryBtn.textContent = 'Пройти тест снова';
        retryBtn.className = 'retry-btn';
        retryBtn.style.display = 'none';
        retryBtn.onclick = () => location.reload();
        testContainer.appendChild(retryBtn);

        // 4. Копии массивов сайтов для пошаговой обработки
        const sitesLeft = {};
        categories.forEach(cat => {
            sitesLeft[cat] = [...sitesData[cat]];
        });

        let firstAttemptDone = false;

        // 5. Функция обновления категории (прогресс-бар и статистика)
        const updateCategory = (cat, isSuccess) => {
            const data = categoryRows[cat];
            data.attempts++;
            if (isSuccess) data.success++;
            data.statsSpan.textContent = `[${data.success}/${data.attempts}/${data.total}]`;

            const progress = data.attempts / data.total; // от 0 до 1
            const totalRects = 5;
            const fullRects = Math.floor(progress * totalRects);
            const remainder = (progress * totalRects) - fullRects;

            data.rects.forEach((rect, index) => {
                let fillPercent = 0;
                if (index < fullRects) fillPercent = 100;
                else if (index === fullRects) fillPercent = remainder * 100;
                rect.style.setProperty('--fill-percent', fillPercent + '%');
            });
        };

        // 6. Функция формирования сообщения (приоритет: VPN > normal > white > internet)
        const getStatusMessage = () => {
            const vpn = categoryRows.vpn;
            const normal = categoryRows.normal;
            const white = categoryRows.white;
            const internet = categoryRows.internet;

            const vpnPct = vpn.attempts ? (vpn.success / vpn.attempts) * 100 : 0;
            const normalPct = normal.attempts ? (normal.success / normal.attempts) * 100 : 0;
            const whitePct = white.attempts ? (white.success / white.attempts) * 100 : 0;
            const internetPct = internet.attempts ? (internet.success / internet.attempts) * 100 : 0;

            if (vpnPct > 70) return 'Вероятно, ваш впн работает отлично';
            if (vpnPct > 30) return 'Вероятно, ваш впн работает частично';
            if (normalPct > 30) return 'Вероятно, сеть работает стандартно';
            if (whitePct > 30) return 'Вероятно, белый список работает штатно';
            return 'Вероятно, у вас нет интернета';
        };

        // 7. Основной цикл (обходим категории по кругу, пока есть сайты)
        let anyLeft = true;
        while (anyLeft) {
            anyLeft = false;
            for (const cat of categories) {
                const sites = sitesLeft[cat];
                if (sites.length === 0) continue;
                anyLeft = true;

                const site = sites.shift();
                console.log(`⏳ Запрос к ${site} (категория ${cat})`);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                let success = false;
                try {
                    await fetch(site, {
                        method: 'HEAD',
                        mode: 'no-cors',
                        cache: 'no-cache',
                        signal: controller.signal
                    });
                    success = true;
                    console.log(`✅ Успех: ${site}`);
                } catch (err) {
                    console.log(`❌ Ошибка/таймаут: ${site} — ${err.message}`);
                } finally {
                    clearTimeout(timeoutId);
                }

                updateCategory(cat, success);

                if (!firstAttemptDone) {
                    firstAttemptDone = true;
                    statusDiv.textContent = getStatusMessage();

                    // Создаём кнопку установки, если ещё не создана
                    if (!installBtn) {
                        installBtn = document.createElement('button');
                        installBtn.textContent = 'Установить на своё устройство';
                        installBtn.className = 'install-btn'; // добавим класс для стилизации
                        installBtn.onclick = handleInstall; // глобальная функция
                        // Вставляем после statusDiv, но перед retryBtn
                        testContainer.insertBefore(installBtn, retryBtn);
                    }
                } else {
                    // Обновляем сообщение после каждого запроса
                    statusDiv.textContent = getStatusMessage();
                }

                statusDiv.textContent = getStatusMessage();
                await new Promise(resolve => setTimeout(resolve, 50)); // небольшая пауза
            }
        }

        retryBtn.style.display = 'block';
        console.log('🏁 Тест завершён. Итоговые результаты:', categoryRows);
        testRunning = false;
    });
});

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

window.addEventListener('appinstalled', () => {
    isInstalled = true;
    deferredPrompt = null;
});

function handleInstall() {
    if (isInstalled) {
        alert('Уже установлено!');
        return;
    }
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
    } else {
        showInstallInstructions();
    }
}

function showInstallInstructions() {
    const ua = navigator.userAgent.toLowerCase();
    let msg = 'Инструкция по установке:\n';
    if (ua.includes('iphone') || ua.includes('ipad')) msg += 'Safari > Поделиться > На экран "Домой"';
    else if (ua.includes('android')) msg += 'Chrome > Меню > Добавить на главный экран';
    else msg += 'Chrome/Edge > Адресная строка > ⋮ > Установить';
    alert(msg);
}