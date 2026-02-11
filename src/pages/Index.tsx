import { useSeoMeta } from '@unhead/react';
import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { NostrEvent } from '@nostrify/nostrify';

type ConnectionState = 'disconnected' | 'connecting' | 'connected';

const Index = () => {
  useSeoMeta({
    title: 'Relay Note Explorer',
    description: 'Simple Nostr relay explorer to view events from any relay',
  });

  const [relayUrl, setRelayUrl] = useState('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<NostrEvent | null>(null);

  const isValidUrl = relayUrl.length > 0;
  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';

  useEffect(() => {
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [ws]);

  const handleConnect = () => {
    if (connectionState === 'connected' || connectionState === 'connecting') {
      // Disconnect
      if (ws) {
        ws.close();
      }
      setWs(null);
      setConnectionState('disconnected');
      setEvents([]);
      setSelectedEvent(null);
      return;
    }

    // Connect
    const url = relayUrl.startsWith('wss://') ? relayUrl : `wss://${relayUrl}`;
    setConnectionState('connecting');

    const websocket = new WebSocket(url);

    websocket.onopen = () => {
      setConnectionState('connected');
      // Subscribe to all events
      const subscription = JSON.stringify(['REQ', 'all-events', {}]);
      websocket.send(subscription);
    };

    websocket.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data[0] === 'EVENT' && data[2]) {
          setEvents((prev) => {
            // Avoid duplicates
            if (prev.some(e => e.id === data[2].id)) {
              return prev;
            }
            return [...prev, data[2]].sort((a, b) => b.created_at - a.created_at);
          });
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnectionState('disconnected');
    };

    websocket.onclose = () => {
      setConnectionState('disconnected');
    };

    setWs(websocket);
  };

  const handleRelayUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRelayUrl(e.target.value);
  };

  const getKindName = (kind: number): string => {
    const kindNames: Record<number, string> = {
      0: 'Metadata',
      1: 'Text Note',
      3: 'Contacts',
      4: 'Encrypted DM',
      5: 'Delete',
      6: 'Repost',
      7: 'Reaction',
      10002: 'Relay List',
      30023: 'Long-form',
    };
    return kindNames[kind] || `Kind ${kind}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
            Relay Note Explorer
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Connect to any Nostr relay and explore events
          </p>
        </div>

        {/* Connection Input */}
        <div className="flex gap-3 mb-8">
          <Input
            type="text"
            placeholder="relay.ditto.pub"
            value={relayUrl}
            onChange={handleRelayUrlChange}
            disabled={isConnected || isConnecting}
            className="flex-1 text-lg h-12"
          />
          <Button
            onClick={handleConnect}
            disabled={!isValidUrl && !isConnected && !isConnecting}
            className="h-12 px-8 text-base"
            variant={isConnected ? 'destructive' : 'default'}
          >
            {isConnecting ? 'Connecting...' : isConnected ? 'Disconnect' : 'Connect'}
          </Button>
        </div>

        {/* Events Display - Fibonacci ratio columns (5:8) */}
        {(isConnected || isConnecting) && (
          <div className="grid grid-cols-13 gap-6">
            {/* Left Column - Events List (5 parts) */}
            <Card className="col-span-5 h-[calc(100vh-280px)]">
              <CardContent className="p-0 h-full flex flex-col">
                <div className="p-4 border-b bg-slate-50 dark:bg-slate-900/50">
                  <h2 className="font-semibold text-lg">
                    Events ({events.length})
                  </h2>
                </div>
                <div className="overflow-y-auto flex-1">
                  {events.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                      <p>Waiting for events...</p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {events.map((event) => (
                        <button
                          key={event.id}
                          onClick={() => setSelectedEvent(event)}
                          className={`w-full text-left p-4 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
                            selectedEvent?.id === event.id
                              ? 'bg-violet-50 dark:bg-violet-950/30 border-l-4 border-violet-600'
                              : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="font-mono text-xs bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded">
                              {getKindName(event.kind)}
                            </span>
                            <span className="text-xs text-slate-500">
                              {new Date(event.created_at * 1000).toLocaleTimeString()}
                            </span>
                          </div>
                          <div className="text-sm text-slate-600 dark:text-slate-400 truncate font-mono">
                            {event.id.substring(0, 16)}...
                          </div>
                          {event.content && (
                            <div className="text-sm text-slate-700 dark:text-slate-300 truncate mt-1">
                              {event.content.substring(0, 50)}
                              {event.content.length > 50 ? '...' : ''}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Right Column - Event Details (8 parts) */}
            <Card className="col-span-8 h-[calc(100vh-280px)]">
              <CardContent className="p-0 h-full flex flex-col">
                <div className="p-4 border-b bg-slate-50 dark:bg-slate-900/50">
                  <h2 className="font-semibold text-lg">Event Details</h2>
                </div>
                <div className="overflow-y-auto flex-1 p-6">
                  {selectedEvent ? (
                    <pre className="text-sm font-mono bg-slate-900 text-slate-100 p-6 rounded-lg overflow-x-auto">
                      {JSON.stringify(selectedEvent, null, 2)}
                    </pre>
                  ) : (
                    <div className="flex items-center justify-center h-full text-slate-500">
                      <p>Select an event to view details</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-slate-500">
          <a
            href="https://shakespeare.diy"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-violet-600 transition-colors"
          >
            Vibed with Shakespeare
          </a>
        </div>
      </div>
    </div>
  );
};

export default Index;
