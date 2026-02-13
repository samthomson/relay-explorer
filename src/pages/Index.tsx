import { useSeoMeta } from '@unhead/react';
import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, X } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

type ConnectionState = 'disconnected' | 'connecting' | 'connected';

interface NostrFilter {
  kinds?: number[];
  authors?: string[];
  limit?: number;
}

const COMMON_KINDS = [
  { value: 0, label: 'Metadata' },
  { value: 1, label: 'Text Note' },
  { value: 3, label: 'Contacts' },
  { value: 4, label: 'Encrypted DM' },
  { value: 5, label: 'Delete' },
  { value: 6, label: 'Repost' },
  { value: 7, label: 'Reaction' },
  { value: 9735, label: 'Zap' },
  { value: 10002, label: 'Relay List' },
  { value: 30023, label: 'Long-form' },
  { value: 31990, label: 'App Handler' },
];

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
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Advanced filter states
  const [authorNpub, setAuthorNpub] = useState('');
  const [selectedKinds, setSelectedKinds] = useState<number[]>([]);
  const [customKind, setCustomKind] = useState('');
  const [kindSearchQuery, setKindSearchQuery] = useState('');
  const [showKindDropdown, setShowKindDropdown] = useState(false);

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

  const buildFilter = (): NostrFilter => {
    const filter: NostrFilter = { limit: 500 };
    
    // Add kinds filter if any selected
    if (selectedKinds.length > 0) {
      filter.kinds = selectedKinds;
    }
    
    // Add author filter if npub provided
    if (authorNpub.trim()) {
      try {
        const decoded = nip19.decode(authorNpub.trim());
        if (decoded.type === 'npub') {
          filter.authors = [decoded.data];
        } else if (decoded.type === 'nprofile') {
          filter.authors = [decoded.data.pubkey];
        }
      } catch (e) {
        console.error('Invalid npub:', e);
      }
    }
    
    return filter;
  };

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
      // Subscribe with filter
      const filter = buildFilter();
      const subscription = JSON.stringify(['REQ', 'all-events', filter]);
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

  const handleAddKind = (kind: number) => {
    if (!selectedKinds.includes(kind)) {
      setSelectedKinds([...selectedKinds, kind]);
    }
    setKindSearchQuery('');
    setShowKindDropdown(false);
  };

  const handleRemoveKind = (kind: number) => {
    setSelectedKinds(selectedKinds.filter(k => k !== kind));
  };

  const handleAddCustomKind = () => {
    const kind = parseInt(customKind);
    if (!isNaN(kind) && kind >= 0 && !selectedKinds.includes(kind)) {
      setSelectedKinds([...selectedKinds, kind]);
      setCustomKind('');
    }
  };

  const filteredCommonKinds = COMMON_KINDS.filter(k => 
    k.label.toLowerCase().includes(kindSearchQuery.toLowerCase()) ||
    k.value.toString().includes(kindSearchQuery)
  );

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
        <div className="mb-6">
          <div className="flex gap-3">
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

          {/* Advanced Options */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced} className="mt-4">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-sm text-slate-600 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400"
                disabled={isConnected || isConnecting}
              >
                Advanced Options
                <ChevronDown className={`ml-2 h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            
            <CollapsibleContent className="mt-4">
              <Card className="bg-slate-50/50 dark:bg-slate-900/50">
                <CardContent className="p-4 space-y-4">
                  {/* Author Filter */}
                  <div className="space-y-2">
                    <Label htmlFor="author-npub" className="text-sm font-medium">
                      Author (npub)
                    </Label>
                    <Input
                      id="author-npub"
                      type="text"
                      placeholder="npub1... or nprofile1..."
                      value={authorNpub}
                      onChange={(e) => setAuthorNpub(e.target.value)}
                      className="h-10"
                    />
                  </div>

                  {/* Kinds Filter */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Event Kinds</Label>
                    
                    {/* Selected Kinds */}
                    {selectedKinds.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {selectedKinds.map((kind) => (
                          <Badge
                            key={kind}
                            variant="secondary"
                            className="pl-2 pr-1 py-1 gap-1"
                          >
                            {COMMON_KINDS.find(k => k.value === kind)?.label || `Kind ${kind}`}
                            <button
                              onClick={() => handleRemoveKind(kind)}
                              className="ml-1 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-full p-0.5"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2">
                      {/* Kind Typeahead */}
                      <div className="flex-1 relative">
                        <Input
                          type="text"
                          placeholder="Search common kinds..."
                          value={kindSearchQuery}
                          onChange={(e) => {
                            setKindSearchQuery(e.target.value);
                            setShowKindDropdown(true);
                          }}
                          onFocus={() => setShowKindDropdown(true)}
                          onBlur={() => setTimeout(() => setShowKindDropdown(false), 200)}
                          className="h-10"
                        />
                        {showKindDropdown && kindSearchQuery && filteredCommonKinds.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border rounded-md shadow-lg max-h-60 overflow-y-auto">
                            {filteredCommonKinds.map((kind) => (
                              <button
                                key={kind.value}
                                onClick={() => handleAddKind(kind.value)}
                                className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm flex items-center justify-between"
                              >
                                <span>{kind.label}</span>
                                <span className="text-xs text-slate-500 font-mono">{kind.value}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Custom Kind Input */}
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          placeholder="Custom kind"
                          value={customKind}
                          onChange={(e) => setCustomKind(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddCustomKind()}
                          className="h-10 w-32"
                          min="0"
                        />
                        <Button
                          onClick={handleAddCustomKind}
                          disabled={!customKind || isNaN(parseInt(customKind))}
                          size="sm"
                          variant="outline"
                          className="h-10"
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>
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
