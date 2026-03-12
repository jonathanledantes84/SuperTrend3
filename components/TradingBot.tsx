'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Play, 
  Square, 
  Settings, 
  Activity, 
  History, 
  Wallet, 
  TrendingUp, 
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Eye,
  EyeOff
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine,
  AreaChart,
  Area
} from 'recharts';
import { format } from 'date-fns';
import { RestClientV5 } from 'bybit-api';
import { calculateSuperTrend, KLine, SuperTrendResult } from '@/lib/indicators';

// --- Types ---
interface LogEntry {
  id: string;
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface Trade {
  id: string;
  timestamp: Date;
  type: 'BUY' | 'SELL';
  price: number;
  amount: number;
  total: number;
  status: 'COMPLETED' | 'FAILED';
}

// --- Main Component ---
export function TradingBot() {
  // Config State
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [showKeys, setShowKeys] = useState(false);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('15'); // 1, 3, 5, 15, 30, 60, 120, 240, D, W, M
  const [atrPeriod, setAtrPeriod] = useState(10);
  const [atrMultiplier, setAtrMultiplier] = useState(3);
  const [tradeAmount, setTradeAmount] = useState(10); // USDT amount per trade
  
  // Bot State
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [marketData, setMarketData] = useState<SuperTrendResult[]>([]);
  const [balance, setBalance] = useState({ usdt: 0, asset: 0 });
  const [currentPrice, setCurrentPrice] = useState(0);
  const [lastSignal, setLastSignal] = useState<'up' | 'down' | null>(null);

  // Refs for persistent values in loop
  const isRunningRef = useRef(false);
  const clientRef = useRef<RestClientV5 | null>(null);

  // --- Extension Sync ---
  useEffect(() => {
    const chrome = (window as any).chrome;
    if (typeof window !== 'undefined' && chrome && chrome.storage) {
      chrome.storage.local.get([
        'apiKey', 'apiSecret', 'symbol', 'interval', 'atrPeriod', 'atrMultiplier', 'tradeAmount', 'isRunning'
      ], (result: any) => {
        if (result.apiKey) setApiKey(result.apiKey);
        if (result.apiSecret) setApiSecret(result.apiSecret);
        if (result.symbol) setSymbol(result.symbol);
        if (result.interval) setInterval(result.interval);
        if (result.atrPeriod) setAtrPeriod(result.atrPeriod);
        if (result.atrMultiplier) setAtrMultiplier(result.atrMultiplier);
        if (result.tradeAmount) setTradeAmount(result.tradeAmount);
        if (result.isRunning) setIsRunning(result.isRunning);
      });
    }
  }, []);

  useEffect(() => {
    const chrome = (window as any).chrome;
    if (typeof window !== 'undefined' && chrome && chrome.storage) {
      chrome.storage.local.set({
        apiKey, apiSecret, symbol, interval, atrPeriod, atrMultiplier, tradeAmount, isRunning
      });
    }
  }, [apiKey, apiSecret, symbol, interval, atrPeriod, atrMultiplier, tradeAmount, isRunning]);

  // --- Helpers ---
  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [{
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      message,
      type
    }, ...prev].slice(0, 100));
  };

  const initClient = () => {
    if (!apiKey || !apiSecret) return null;
    return new RestClientV5({
      key: apiKey,
      secret: apiSecret,
      testnet: false, // Set to true for testing if needed
    });
  };

  // --- API Calls ---
  const fetchMarketData = async () => {
    try {
      const client = new RestClientV5(); // Public client for K-lines
      const response = await client.getKline({
        category: 'spot',
        symbol: symbol,
        interval: interval as any,
        limit: 100,
      });

      if (response.retCode !== 0) throw new Error(response.retMsg);

      const klines: KLine[] = response.result.list.map((item: any) => ({
        time: parseInt(item[0]),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
      })).reverse();

      const results = calculateSuperTrend(klines, atrPeriod, atrMultiplier);
      setMarketData(results);
      if (results.length > 0) {
        setCurrentPrice(results[results.length - 1].price);
      }
      return results;
    } catch (error: any) {
      addLog(`Error fetching market data: ${error.message}`, 'error');
      return [];
    }
  };

  const fetchBalance = async () => {
    if (!clientRef.current) return;
    try {
      const response = await clientRef.current.getWalletBalance({
        accountType: 'UNIFIED',
        coin: `USDT,${symbol.replace('USDT', '')}`,
      });

      if (response.retCode === 0) {
        const usdt = response.result.list[0].coin.find(c => c.coin === 'USDT');
        const asset = response.result.list[0].coin.find(c => c.coin === symbol.replace('USDT', ''));
        setBalance({
          usdt: parseFloat(usdt?.walletBalance || '0'),
          asset: parseFloat(asset?.walletBalance || '0'),
        });
      }
    } catch (error: any) {
      addLog(`Error fetching balance: ${error.message}`, 'error');
    }
  };

  const executeTrade = async (type: 'BUY' | 'SELL', price: number) => {
    if (!clientRef.current) return;
    
    try {
      addLog(`Executing ${type} order for ${symbol}...`, 'warning');
      
      // In a real bot, you'd calculate the exact quantity based on balance and tradeAmount
      // For this demo, we'll use a simplified market order
      const qty = type === 'BUY' 
        ? (tradeAmount / price).toFixed(6) 
        : balance.asset.toFixed(6);

      if (parseFloat(qty) <= 0) {
        addLog(`Insufficient quantity for ${type}`, 'error');
        return;
      }

      const response = await clientRef.current.submitOrder({
        category: 'spot',
        symbol: symbol,
        side: type === 'BUY' ? 'Buy' : 'Sell',
        orderType: 'Market',
        qty: qty,
      });

      if (response.retCode === 0) {
        addLog(`${type} order successful! Order ID: ${response.result.orderId}`, 'success');
        setTrades(prev => [{
          id: response.result.orderId,
          timestamp: new Date(),
          type,
          price,
          amount: parseFloat(qty),
          total: parseFloat(qty) * price,
          status: 'COMPLETED'
        }, ...prev]);
        fetchBalance();
      } else {
        throw new Error(response.retMsg);
      }
    } catch (error: any) {
      addLog(`Trade execution failed: ${error.message}`, 'error');
    }
  };

  // --- Bot Loop ---
  useEffect(() => {
    let timer: NodeJS.Timeout;

    const loop = async () => {
      if (!isRunningRef.current) return;

      const results = await fetchMarketData();
      if (results.length < 2) return;

      const current = results[results.length - 1];
      const previous = results[results.length - 2];

      // Signal Logic
      if (current.trend === 'up' && previous.trend === 'down') {
        addLog(`BUY Signal detected at ${current.price}`, 'success');
        await executeTrade('BUY', current.price);
      } else if (current.trend === 'down' && previous.trend === 'up') {
        addLog(`SELL Signal detected at ${current.price}`, 'warning');
        await executeTrade('SELL', current.price);
      }

      setLastSignal(current.trend);
      
      // Refresh balance occasionally
      fetchBalance();

      if (isRunningRef.current) {
        timer = setTimeout(loop, 10000); // Check every 10 seconds
      }
    };

    if (isRunning) {
      isRunningRef.current = true;
      clientRef.current = initClient();
      addLog('Bot started', 'success');
      loop();
    } else {
      isRunningRef.current = false;
      addLog('Bot stopped', 'warning');
    }

    return () => {
      clearTimeout(timer);
      isRunningRef.current = false;
    };
  }, [isRunning]);

  // Initial load
  useEffect(() => {
    fetchMarketData();
  }, [symbol, interval]);

  // --- Render ---
  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-[#141414] p-6 rounded-2xl border border-white/5">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <Activity className="text-emerald-500 w-8 h-8" />
            Bybit SuperTrend Bot
          </h1>
          <p className="text-white/50 text-sm mt-1">Trading algorítmico automatizado en Bybit Spot</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsRunning(!isRunning)}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all ${
              isRunning 
                ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20' 
                : 'bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)]'
            }`}
          >
            {isRunning ? (
              <>
                <Square className="w-4 h-4 fill-current" /> Detener Bot
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" /> Iniciar Bot
              </>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Config & Balance */}
        <div className="space-y-6">
          {/* API Config */}
          <div className="bg-[#141414] p-6 rounded-2xl border border-white/5 space-y-4">
            <div className="flex items-center gap-2 text-white/70 font-medium mb-2">
              <Settings className="w-4 h-4" />
              Configuración API
            </div>
            <div className="space-y-3">
              <div className="relative">
                <input
                  type={showKeys ? "text" : "password"}
                  placeholder="Bybit API Key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
              <div className="relative">
                <input
                  type={showKeys ? "text" : "password"}
                  placeholder="Bybit API Secret"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
                <button 
                  onClick={() => setShowKeys(!showKeys)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                >
                  {showKeys ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          </div>

          {/* Strategy Params */}
          <div className="bg-[#141414] p-6 rounded-2xl border border-white/5 space-y-4">
            <div className="flex items-center gap-2 text-white/70 font-medium mb-2">
              <TrendingUp className="w-4 h-4" />
              Parámetros de Estrategia
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-white/40">Símbolo</label>
                <select 
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none"
                >
                  <option value="BTCUSDT">BTC/USDT</option>
                  <option value="ETHUSDT">ETH/USDT</option>
                  <option value="SOLUSDT">SOL/USDT</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-white/40">Intervalo</label>
                <select 
                  value={interval}
                  onChange={(e) => setInterval(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none"
                >
                  <option value="1">1m</option>
                  <option value="5">5m</option>
                  <option value="15">15m</option>
                  <option value="60">1h</option>
                  <option value="240">4h</option>
                  <option value="D">1D</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-white/40">ATR Period</label>
                <input 
                  type="number"
                  value={atrPeriod}
                  onChange={(e) => setAtrPeriod(parseInt(e.target.value))}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-white/40">Multiplier</label>
                <input 
                  type="number"
                  step="0.1"
                  value={atrMultiplier}
                  onChange={(e) => setAtrMultiplier(parseFloat(e.target.value))}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none"
                />
              </div>
            </div>
            <div className="space-y-1 pt-2">
              <label className="text-[10px] uppercase tracking-wider text-white/40">Monto por Trade (USDT)</label>
              <input 
                type="number"
                value={tradeAmount}
                onChange={(e) => setTradeAmount(parseFloat(e.target.value))}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>

          {/* Wallet */}
          <div className="bg-[#141414] p-6 rounded-2xl border border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/70 font-medium">
                <Wallet className="w-4 h-4" />
                Billetera
              </div>
              <button onClick={fetchBalance} className="text-white/30 hover:text-emerald-500 transition-colors">
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                <div className="text-[10px] uppercase text-white/40 mb-1">USDT</div>
                <div className="text-lg font-mono font-bold text-emerald-400">{balance.usdt.toFixed(2)}</div>
              </div>
              <div className="bg-black/20 p-4 rounded-xl border border-white/5">
                <div className="text-[10px] uppercase text-white/40 mb-1">{symbol.replace('USDT', '')}</div>
                <div className="text-lg font-mono font-bold text-white">{balance.asset.toFixed(4)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Center Column: Chart & Stats */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[#141414] p-4 rounded-2xl border border-white/5">
              <div className="text-[10px] uppercase text-white/40 mb-1">Precio Actual</div>
              <div className="text-xl font-mono font-bold text-white">${currentPrice.toLocaleString()}</div>
            </div>
            <div className="bg-[#141414] p-4 rounded-2xl border border-white/5">
              <div className="text-[10px] uppercase text-white/40 mb-1">Tendencia</div>
              <div className={`text-xl font-bold flex items-center gap-2 ${lastSignal === 'up' ? 'text-emerald-500' : 'text-red-500'}`}>
                {lastSignal === 'up' ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                {lastSignal === 'up' ? 'ALCISTA' : 'BAJISTA'}
              </div>
            </div>
            <div className="bg-[#141414] p-4 rounded-2xl border border-white/5">
              <div className="text-[10px] uppercase text-white/40 mb-1">Trades (Sesión)</div>
              <div className="text-xl font-mono font-bold text-white">{trades.length}</div>
            </div>
            <div className="bg-[#141414] p-4 rounded-2xl border border-white/5">
              <div className="text-[10px] uppercase text-white/40 mb-1">Estado Bot</div>
              <div className={`text-xl font-bold flex items-center gap-2 ${isRunning ? 'text-emerald-500' : 'text-white/30'}`}>
                <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-white/20'}`} />
                {isRunning ? 'ACTIVO' : 'INACTIVO'}
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="bg-[#141414] p-6 rounded-2xl border border-white/5 h-[400px]">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm font-medium text-white/70">Gráfico SuperTrend ({symbol})</div>
              <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest">
                <div className="flex items-center gap-1.5"><div className="w-2 h-0.5 bg-emerald-500" /> Precio</div>
                <div className="flex items-center gap-1.5"><div className="w-2 h-0.5 bg-white/30" /> SuperTrend</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={marketData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                <XAxis 
                  dataKey="time" 
                  hide 
                />
                <YAxis 
                  domain={['auto', 'auto']} 
                  orientation="right"
                  tick={{ fontSize: 10, fill: '#ffffff40' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#141414', border: '1px solid #ffffff10', borderRadius: '12px' }}
                  itemStyle={{ fontSize: '12px' }}
                  labelStyle={{ display: 'none' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="price" 
                  stroke="#10b981" 
                  strokeWidth={2} 
                  dot={false} 
                  animationDuration={300}
                />
                <Line 
                  type="stepAfter" 
                  dataKey="value" 
                  stroke="#ffffff30" 
                  strokeWidth={1.5} 
                  strokeDasharray="5 5"
                  dot={false} 
                  animationDuration={300}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Logs & History Tabs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Logs */}
            <div className="bg-[#141414] rounded-2xl border border-white/5 flex flex-col h-[300px]">
              <div className="p-4 border-bottom border-white/5 flex items-center gap-2 text-white/70 font-medium">
                <Activity className="w-4 h-4" />
                Registros del Sistema
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[11px]">
                {logs.length === 0 && <div className="text-white/20 text-center py-10">No hay registros aún</div>}
                {logs.map(log => (
                  <div key={log.id} className="flex gap-3">
                    <span className="text-white/20">[{format(log.timestamp, 'HH:mm:ss')}]</span>
                    <span className={
                      log.type === 'error' ? 'text-red-400' : 
                      log.type === 'success' ? 'text-emerald-400' : 
                      log.type === 'warning' ? 'text-amber-400' : 'text-white/60'
                    }>
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Trade History */}
            <div className="bg-[#141414] rounded-2xl border border-white/5 flex flex-col h-[300px]">
              <div className="p-4 border-bottom border-white/5 flex items-center gap-2 text-white/70 font-medium">
                <History className="w-4 h-4" />
                Historial de Trades
              </div>
              <div className="flex-1 overflow-y-auto">
                {trades.length === 0 && <div className="text-white/20 text-center py-10 text-sm">No hay operaciones realizadas</div>}
                <table className="w-full text-left text-[11px]">
                  <thead className="text-white/30 uppercase tracking-wider sticky top-0 bg-[#141414]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Hora</th>
                      <th className="px-4 py-2 font-medium">Tipo</th>
                      <th className="px-4 py-2 font-medium">Precio</th>
                      <th className="px-4 py-2 font-medium">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {trades.map(trade => (
                      <tr key={trade.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-4 py-2 text-white/40">{format(trade.timestamp, 'HH:mm:ss')}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded-full font-bold ${trade.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                            {trade.type}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-white/80">${trade.price.toLocaleString()}</td>
                        <td className="px-4 py-2 font-mono text-white/80">{trade.amount.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="bg-emerald-500/5 border border-emerald-500/10 p-4 rounded-2xl flex items-start gap-3">
        <AlertCircle className="text-emerald-500 w-5 h-5 shrink-0 mt-0.5" />
        <div className="text-xs text-emerald-500/70 leading-relaxed">
          <strong>Nota Importante:</strong> Este bot utiliza la estrategia SuperTrend. Asegúrate de tener saldo suficiente en tu cuenta de Bybit Spot (Unified Account). 
          Los parámetros por defecto (10, 3) son estándar, pero puedes ajustarlos según la volatilidad del activo. 
          El bot opera en tiempo real directamente desde esta interfaz.
        </div>
      </div>
    </div>
  );
}
