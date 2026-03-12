export interface KLine {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SuperTrendResult {
  time: number;
  price: number;
  value: number;
  trend: 'up' | 'down';
  upperBand: number;
  lowerBand: number;
}

export function calculateATR(data: KLine[], period: number): number[] {
  const atrs: number[] = [];
  const trs: number[] = [];

  for (let i = 0; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = i > 0 ? data[i - 1].close : data[i].open;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);

    if (i >= period - 1) {
      if (atrs.length === 0) {
        const initialAtr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
        atrs.push(initialAtr);
      } else {
        const prevAtr = atrs[atrs.length - 1];
        const currentAtr = (prevAtr * (period - 1) + tr) / period;
        atrs.push(currentAtr);
      }
    } else {
      atrs.push(0); // Placeholder
    }
  }
  return atrs;
}

export function calculateSuperTrend(
  data: KLine[],
  period: number = 10,
  multiplier: number = 3
): SuperTrendResult[] {
  const atrs = calculateATR(data, period);
  const results: SuperTrendResult[] = [];

  let prevFinalUpper = 0;
  let prevFinalLower = 0;
  let prevTrend: 'up' | 'down' = 'down';

  for (let i = 0; i < data.length; i++) {
    const hl2 = (data[i].high + data[i].low) / 2;
    const atr = atrs[i];
    
    const basicUpper = hl2 + multiplier * atr;
    const basicLower = hl2 - multiplier * atr;

    let finalUpper = basicUpper;
    let finalLower = basicLower;

    if (i > 0) {
      const prevClose = data[i - 1].close;
      finalUpper = (basicUpper < prevFinalUpper || prevClose > prevFinalUpper) ? basicUpper : prevFinalUpper;
      finalLower = (basicLower > prevFinalLower || prevClose < prevFinalLower) ? basicLower : prevFinalLower;
    }

    let currentTrend: 'up' | 'down' = prevTrend;
    if (i > 0) {
      if (prevTrend === 'down' && data[i].close > finalUpper) {
        currentTrend = 'up';
      } else if (prevTrend === 'up' && data[i].close < finalLower) {
        currentTrend = 'down';
      }
    }

    const superTrendValue = currentTrend === 'up' ? finalLower : finalUpper;

    results.push({
      time: data[i].time,
      price: data[i].close,
      value: superTrendValue,
      trend: currentTrend,
      upperBand: finalUpper,
      lowerBand: finalLower
    });

    prevFinalUpper = finalUpper;
    prevFinalLower = finalLower;
    prevTrend = currentTrend;
  }

  return results;
}
