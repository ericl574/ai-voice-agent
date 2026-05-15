'use client';

import { useState, useEffect, useRef } from 'react';
import { SIMULATOR_SCRIPT } from '@/lib/mock-data';

type SimState = 'idle' | 'ringing' | 'active' | 'ended';

export default function SimulatorPage() {
  const [simState, setSimState] = useState<SimState>('idle');
  const [visibleMessages, setVisibleMessages] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages]);

  useEffect(() => {
    if (simState === 'ringing') {
      const t = setTimeout(() => {
        setSimState('active');
      }, 2000);
      return () => clearTimeout(t);
    }

    if (simState === 'active') {
      intervalRef.current = setInterval(() => {
        setElapsed((e) => e + 1);
      }, 1000);

      let i = 0;
      const reveal = () => {
        if (i < SIMULATOR_SCRIPT.length) {
          setVisibleMessages(i + 1);
          i++;
          const delay = i < SIMULATOR_SCRIPT.length ? 1800 : 0;
          if (i < SIMULATOR_SCRIPT.length) {
            setTimeout(reveal, delay);
          } else {
            setTimeout(() => {
              setSimState('ended');
              if (intervalRef.current) clearInterval(intervalRef.current);
            }, 1200);
          }
        }
      };
      setTimeout(reveal, 400);

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
  }, [simState]);

  function reset() {
    setSimState('idle');
    setVisibleMessages(0);
    setElapsed(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Call Simulator</h1>
        <p className="text-sm text-gray-500 mt-1">
          Watch the AI assistant handle a mock incoming call in real time.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="bg-slate-800 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${simState === 'active' ? 'bg-green-400 animate-pulse' : simState === 'ringing' ? 'bg-yellow-400 animate-pulse' : 'bg-slate-500'}`} />
            <span className="text-slate-300 text-sm font-medium">
              {simState === 'idle' && 'Ready'}
              {simState === 'ringing' && 'Incoming call…'}
              {simState === 'active' && 'Call in progress'}
              {simState === 'ended' && 'Call ended'}
            </span>
          </div>
          {simState === 'active' && (
            <span className="text-slate-400 text-xs font-mono">{formatTime(elapsed)}</span>
          )}
          {simState === 'ended' && (
            <span className="text-slate-400 text-xs font-mono">{formatTime(elapsed)}</span>
          )}
        </div>

        <div className="p-5 min-h-64 max-h-96 overflow-y-auto space-y-3">
          {simState === 'idle' && (
            <div className="flex flex-col items-center justify-center h-48 gap-4 text-center">
              <div className="w-14 h-14 bg-orange-50 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <p className="text-sm text-gray-500">Press the button below to simulate an incoming call.</p>
            </div>
          )}

          {simState === 'ringing' && (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
              <div className="w-14 h-14 bg-yellow-50 rounded-full flex items-center justify-center animate-bounce">
                <svg className="w-7 h-7 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-700">Incoming call from (555) 100-2000</p>
              <p className="text-xs text-gray-400">AI assistant answering…</p>
            </div>
          )}

          {(simState === 'active' || simState === 'ended') &&
            SIMULATOR_SCRIPT.slice(0, visibleMessages).map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-2 ${msg.role === 'caller' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'ai' && (
                  <div className="w-7 h-7 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
                    </svg>
                  </div>
                )}
                <div
                  className={`max-w-xs rounded-2xl px-4 py-2 text-sm ${
                    msg.role === 'ai'
                      ? 'bg-gray-100 text-gray-800 rounded-tl-sm'
                      : 'bg-orange-500 text-white rounded-tr-sm'
                  }`}
                >
                  {msg.text}
                </div>
                {msg.role === 'caller' && (
                  <div className="w-7 h-7 bg-slate-200 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          <div ref={messagesEndRef} />
        </div>

        {simState === 'ended' && (
          <div className="mx-5 mb-5 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <p className="font-medium mb-1">Call Summary</p>
            <p>
              Reservation request logged for <strong>John Walker</strong>, party of 4, Saturday May
              17th at 7:00 PM. Status: <strong>Pending staff confirmation.</strong> Staff will
              follow up within 2 hours.
            </p>
          </div>
        )}

        <div className="px-5 pb-5 flex gap-3">
          {simState === 'idle' && (
            <button
              onClick={() => setSimState('ringing')}
              className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              Simulate Incoming Call
            </button>
          )}
          {(simState === 'active' || simState === 'ringing' || simState === 'ended') && (
            <button
              onClick={reset}
              className="flex items-center gap-2 border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700">
        <strong>Note:</strong> This is a simulated demo. No real calls are being made.
        Reservations and orders collected by the AI are always marked as <strong>pending staff confirmation</strong>.
      </div>
    </div>
  );
}
