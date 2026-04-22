// src/context/WSContext.js
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

const WSContext = createContext(null);

export const WSProvider = ({ children, token }) => {
  const ws = useRef(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const listeners = useRef({});
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    if (!token) return;
    const wsUrl = process.env.REACT_APP_WS_URL || `ws://${window.location.host}/ws`;
    try {
      ws.current = new WebSocket(`${wsUrl}?token=${token}`);

      ws.current.onopen = () => {
        setConnected(true);
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      };

      ws.current.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          setLastMessage(data);
          const handler = listeners.current[data.type];
          if (handler) handler(data);
        } catch {}
      };

      ws.current.onclose = () => {
        setConnected(false);
        reconnectTimer.current = setTimeout(connect, 5000);
      };

      ws.current.onerror = () => {
        setConnected(false);
      };
    } catch {}
  }, [token]);

  useEffect(() => {
    connect();
    return () => {
      if (ws.current) ws.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  const subscribe = useCallback((type, handler) => {
    listeners.current[type] = handler;
    return () => delete listeners.current[type];
  }, []);

  return (
    <WSContext.Provider value={{ connected, lastMessage, subscribe }}>
      {children}
    </WSContext.Provider>
  );
};

export const useWS = () => useContext(WSContext);
