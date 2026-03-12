// Background Service Worker para el Bot de Trading
// Este script se encarga de mantener el bot ejecutándose en segundo plano

chrome.runtime.onInstalled.addListener(() => {
  console.log('Bybit SuperTrend Bot Extension instalada.');
});

// Escuchar alarmas para el ciclo de trading
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'tradingTick') {
    checkTradingLogic();
  }
});

async function checkTradingLogic() {
  const settings = await chrome.storage.local.get(['isRunning', 'apiKey', 'apiSecret', 'symbol', 'interval', 'atrPeriod', 'atrMultiplier']);
  
  if (!settings.isRunning || !settings.apiKey) return;

  // Aquí iría la lógica de fetch y cálculo que ahora está en el componente
  // Para una extensión real, moveríamos la lógica de indicators.ts aquí también
  console.log('Tick de trading ejecutado para:', settings.symbol);
}

// Iniciar/Detener alarmas basado en el estado
chrome.storage.onChanged.addListener((changes) => {
  if (changes.isRunning) {
    if (changes.isRunning.newValue) {
      chrome.alarms.create('tradingTick', { periodInMinutes: 1 });
    } else {
      chrome.alarms.clear('tradingTick');
    }
  }
});
