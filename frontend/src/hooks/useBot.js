// src/hooks/useBot.js
import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import api from '../utils/api';

export const useBot = () => {
  const [botActive, setBotActive] = useState(false);
  const [botStatus, setBotStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState([]);
  const MAX_EVENTS = 50;

  const addEvent = useCallback((event) => {
    setEvents(prev => [{ ...event, time: new Date().toLocaleTimeString(), id: Date.now() }, ...prev].slice(0, MAX_EVENTS));
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get('/bot/status');
      setBotActive(res.data.active);
      setBotStatus(res.data);
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const startBot = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.post('/bot/start');
      setBotActive(true);
      toast.success(`🤖 Kym started! Trading ${res.data.timeframe} on ${Array.isArray(res.data.pairs) ? res.data.pairs.join(', ') : res.data.pairs}`);
      addEvent({ type: 'bot_started', message: res.data.message });
      fetchStatus();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start bot');
    } finally {
      setLoading(false);
    }
  }, [addEvent, fetchStatus]);

  const stopBot = useCallback(async () => {
    setLoading(true);
    try {
      await api.post('/bot/stop');
      setBotActive(false);
      toast.error('⏹ Kym stopped');
      addEvent({ type: 'bot_stopped', message: 'Bot manually stopped' });
      fetchStatus();
    } catch (err) {
      toast.error('Failed to stop bot');
    } finally {
      setLoading(false);
    }
  }, [addEvent, fetchStatus]);

  // Handle WebSocket messages from WSContext
  const handleWSMessage = useCallback((data) => {
    if (!data || !data.type) return;
    addEvent(data);
    switch (data.type) {
      case 'trade_opened':
        toast.success(data.message, { duration: 5000 });
        break;
      case 'positions_closed':
        toast(data.message, { icon: data.reason === 'TARGET_PROFIT_REACHED' ? '✅' : '🛑', duration: 6000 });
        break;
      case 'bot_error':
        toast.error(data.message);
        break;
      case 'profit_cycle':
        toast.success(data.message, { duration: 4000 });
        break;
      default:
        break;
    }
  }, [addEvent]);

  return { botActive, botStatus, loading, events, startBot, stopBot, handleWSMessage };
};
