import { useSeoMeta } from '@unhead/react';
import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, X, Trash2 } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { formatDistanceToNow } from 'date-fns';

type ConnectionState = 'disconnected' | 'connecting' | 'connected';

interface NostrFilter {
  ids?: string[];
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

  // Check for iframe/embed mode via URL parameters
  const [iframeMode, setIframeMode] = useState(false);
  const [iframeRelay, setIframeRelay] = useState<string | null>(null);

  // Load from localStorage or URL params
  const [relayUrl, setRelayUrl] = useState(() => {
    // Check URL params first
    const params = new URLSearchParams(window.location.search);
    const relayParam = params.get('relay');
    if (relayParam) {
      return relayParam;
    }
    return localStorage.getItem('relay-explorer:url') || '';
  });
  
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<NostrEvent | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Advanced filter states with localStorage
  const [authorNpub, setAuthorNpub] = useState(() => localStorage.getItem('relay-explorer:author') || '');
  const [eventId, setEventId] = useState(() => localStorage.getItem('relay-explorer:eventId') || '');
  const [selectedKinds, setSelectedKinds] = useState<number[]>(() => {
    const stored = localStorage.getItem('relay-explorer:kinds');
    return stored ? JSON.parse(stored) : [];
  });
  const [customKind, setCustomKind] = useState('');
  const [kindSearchQuery, setKindSearchQuery] = useState('');
  const [showKindDropdown, setShowKindDropdown] = useState(false);

  const isValidUrl = relayUrl.length > 0;
  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';

  // Initialize iframe mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const relayParam = params.get('relay');
    
    if (relayParam) {
      setIframeMode(true);
      setIframeRelay(relayParam);
      setRelayUrl(relayParam);
    }
  }, []);

  // Persist to localStorage when values change (skip in iframe mode)
  useEffect(() => {
    if (relayUrl && !iframeMode) {
      localStorage.setItem('relay-explorer:url', relayUrl);
    }
  }, [relayUrl, iframeMode]);

  useEffect(() => {
    if (authorNpub) {
      localStorage.setItem('relay-explorer:author', authorNpub);
    }
  }, [authorNpub]);

  useEffect(() => {
    if (eventId) {
      localStorage.setItem('relay-explorer:eventId', eventId);
    }
  }, [eventId]);

  useEffect(() => {
    localStorage.setItem('relay-explorer:kinds', JSON.stringify(selectedKinds));
  }, [selectedKinds]);

  useEffect(() => {
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, [ws]);

  // Auto-connect in iframe mode
  useEffect(() => {
    if (iframeMode && iframeRelay && !isConnected && !isConnecting) {
      // Small delay to ensure component is fully mounted
      setTimeout(() => {
        handleConnect();
      }, 100);
    }
  }, [iframeMode, iframeRelay]);

  const buildFilter = (): NostrFilter => {
    const filter: NostrFilter = { limit: 500 };
    
    // Add event ID filter if provided
    if (eventId.trim()) {
      filter.ids = [eventId.trim()];
    }
    
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

  const handleResubscribe = () => {
    if (ws && isConnected) {
      // Close existing subscription
      ws.send(JSON.stringify(['CLOSE', 'all-events']));
      // Clear events
      setEvents([]);
      setSelectedEvent(null);
      // Send new subscription with updated filters
      const filter = buildFilter();
      const subscription = JSON.stringify(['REQ', 'all-events', filter]);
      ws.send(subscription);
    }
  };

  const handleRelayUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRelayUrl(e.target.value);
  };

  const handleAddKind = (kind: number) => {
    if (!selectedKinds.includes(kind)) {
      setSelectedKinds([...selectedKinds, kind]);
      if (isConnected) {
        setTimeout(handleResubscribe, 100);
      }
    }
    setKindSearchQuery('');
    setShowKindDropdown(false);
  };

  const handleRemoveKind = (kind: number) => {
    setSelectedKinds(selectedKinds.filter(k => k !== kind));
    if (isConnected) {
      setTimeout(handleResubscribe, 100);
    }
  };

  const handleAddCustomKind = () => {
    const kind = parseInt(customKind);
    if (!isNaN(kind) && kind >= 0 && !selectedKinds.includes(kind)) {
      setSelectedKinds([...selectedKinds, kind]);
      setCustomKind('');
      if (isConnected) {
        setTimeout(handleResubscribe, 100);
      }
    }
  };

  const handleAuthorChange = (value: string) => {
    setAuthorNpub(value);
    if (isConnected) {
      setTimeout(handleResubscribe, 100);
    }
  };

  const handleEventIdChange = (value: string) => {
    setEventId(value);
    if (isConnected) {
      setTimeout(handleResubscribe, 100);
    }
  };

  const handleDeleteEvent = (eventId: string) => {
    if (!ws || !isConnected) return;
    
    // Create a kind 5 deletion event
    const deleteEvent = {
      kind: 5,
      content: 'Deleted via relay-explorer',
      tags: [['e', eventId]],
      created_at: Math.floor(Date.now() / 1000),
    };
    
    // Publish the delete event to the relay
    ws.send(JSON.stringify(['EVENT', deleteEvent]));
    
    // Optimistically remove from UI
    setEvents((prev) => prev.filter(e => e.id !== eventId));
    if (selectedEvent?.id === eventId) {
      setSelectedEvent(null);
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
    <div className="min-h-screen bg-slate-950">
      <div className="container mx-auto p-6">
        {/* Header */}
        {!iframeMode && (
          <div className="mb-6 pb-4 border-b border-slate-700">
            <h1 className="text-2xl font-mono font-semibold text-slate-50 mb-1">
              relay-explorer
            </h1>
            <p className="text-sm text-slate-300 font-mono">
              WebSocket event inspector for Nostr relays
            </p>
          </div>
        )}

        {/* Connection Panel */}
        {!iframeMode && (
          <div className="mb-6 bg-slate-900 border border-slate-600 rounded-lg p-4">
            <div className="flex gap-3 mb-3">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-mono pointer-events-none">
                  wss://
                </span>
                <Input
                  type="text"
                  placeholder="relay.ditto.pub"
                  value={relayUrl}
                  onChange={handleRelayUrlChange}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isValidUrl && !isConnected && !isConnecting) {
                      handleConnect();
                    }
                  }}
                  disabled={isConnected || isConnecting}
                  className="pl-16 h-10 bg-slate-800 border-slate-500 font-mono text-sm text-slate-50"
                />
              </div>
              <Button
                onClick={handleConnect}
                disabled={!isValidUrl && !isConnected && !isConnecting}
                className="h-10 px-6 font-mono text-sm"
                variant={isConnected ? 'destructive' : 'default'}
              >
                {isConnecting ? 'CONNECTING...' : isConnected ? 'DISCONNECT' : 'CONNECT'}
              </Button>
            </div>

          {/* Advanced Filters */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <button
                className="flex items-center gap-2 text-xs font-mono text-neutral-400 hover:text-neutral-300 transition-colors"
              >
                <span className="uppercase tracking-wider">Filters</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                {isConnected && (selectedKinds.length > 0 || authorNpub || eventId) && (
                  <span className="text-neutral-600">·</span>
                )}
                {isConnected && (selectedKinds.length > 0 || authorNpub || eventId) && (
                  <span className="text-neutral-600 text-xs">live update enabled</span>
                )}
              </button>
            </CollapsibleTrigger>
            
            <CollapsibleContent className="mt-3 pt-3 border-t border-neutral-800">
              <div className="grid grid-cols-3 gap-2">
                {/* Event ID Filter */}
                <div className="space-y-1">
                  <label htmlFor="event-id" className="text-xs font-mono text-neutral-500 uppercase tracking-wide">
                    Event ID
                  </label>
                  <Input
                    id="event-id"
                    type="text"
                    placeholder="hex event id..."
                    value={eventId}
                    onChange={(e) => handleEventIdChange(e.target.value)}
                    className="h-8 bg-slate-800 border-slate-500 font-mono text-xs text-slate-50"
                  />
                </div>

                {/* Author Filter */}
                <div className="space-y-1">
                  <label htmlFor="author-npub" className="text-xs font-mono text-neutral-500 uppercase tracking-wide">
                    Authors
                  </label>
                  <Input
                    id="author-npub"
                    type="text"
                    placeholder="npub1..."
                    value={authorNpub}
                    onChange={(e) => handleAuthorChange(e.target.value)}
                    className="h-8 bg-slate-800 border-slate-500 font-mono text-xs text-slate-50"
                  />
                </div>

                {/* Kinds Filter */}
                <div className="space-y-1">
                  <label className="text-xs font-mono text-neutral-500 uppercase tracking-wide">
                    Kinds
                  </label>
                  <div className="flex gap-1.5">
                    <div className="flex-1 relative">
                      <Input
                        type="text"
                        placeholder="Search..."
                        value={kindSearchQuery}
                        onChange={(e) => {
                          setKindSearchQuery(e.target.value);
                          setShowKindDropdown(true);
                        }}
                        onFocus={() => setShowKindDropdown(true)}
                        onBlur={() => setTimeout(() => setShowKindDropdown(false), 200)}
                        className="h-8 bg-neutral-950 border-neutral-700 font-mono text-xs text-neutral-100"
                      />
                      {showKindDropdown && kindSearchQuery && filteredCommonKinds.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-neutral-900 border border-neutral-700 rounded-md shadow-xl max-h-48 overflow-y-auto">
                          {filteredCommonKinds.map((kind) => (
                            <button
                              key={kind.value}
                              onClick={() => handleAddKind(kind.value)}
                              className="w-full text-left px-3 py-2 hover:bg-neutral-800 text-xs font-mono flex items-center justify-between text-neutral-300"
                            >
                              <span>{kind.label}</span>
                              <span className="text-neutral-500">{kind.value}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <Input
                      type="number"
                      placeholder="#"
                      value={customKind}
                      onChange={(e) => setCustomKind(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddCustomKind()}
                      className="h-8 w-12 bg-neutral-950 border-neutral-700 font-mono text-xs text-center text-neutral-100"
                      min="0"
                    />
                    <Button
                      onClick={handleAddCustomKind}
                      disabled={!customKind || isNaN(parseInt(customKind))}
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 font-mono text-xs border-neutral-700"
                    >
                      +
                    </Button>
                  </div>
                </div>
              </div>

              {/* Selected Kinds Pills */}
              {selectedKinds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-neutral-800">
                  {selectedKinds.sort((a, b) => a - b).map((kind) => (
                    <button
                      key={kind}
                      onClick={() => handleRemoveKind(kind)}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-xs font-mono text-neutral-300 transition-colors"
                    >
                      <span className="text-neutral-500">{kind}</span>
                      <span className="text-neutral-600">·</span>
                      <span>{COMMON_KINDS.find(k => k.value === kind)?.label || 'Custom'}</span>
                      <X className="h-3 w-3 ml-0.5 text-neutral-500" />
                    </button>
                  ))}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
          </div>
        )}

        {/* Iframe Mode Header */}
        {iframeMode && (
          <div className="mb-4 pb-3 border-b border-neutral-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-neutral-600 uppercase tracking-wide">Connected to</span>
                <span className="text-xs font-mono text-neutral-400">{relayUrl}</span>
              </div>
              <div className="flex items-center gap-4">
                {/* Filters in iframe mode */}
                <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                  <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-2 text-xs font-mono text-neutral-400 hover:text-neutral-300 transition-colors">
                      <span className="uppercase tracking-wider">Filters</span>
                      <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                    </button>
                  </CollapsibleTrigger>
                </Collapsible>
                <span className="text-xs font-mono text-neutral-600">{events.length} events</span>
              </div>
            </div>
            
            {/* Iframe mode filters */}
            {showAdvanced && (
              <div className="mt-3 pt-3 border-t border-neutral-800">
                <div className="grid grid-cols-3 gap-2">
                  {/* Event ID Filter */}
                  <div className="space-y-1">
                    <label htmlFor="event-id-iframe" className="text-xs font-mono text-neutral-500 uppercase tracking-wide">
                      Event ID
                    </label>
                    <Input
                      id="event-id-iframe"
                      type="text"
                      placeholder="hex event id..."
                      value={eventId}
                      onChange={(e) => handleEventIdChange(e.target.value)}
                      className="h-8 bg-neutral-950 border-neutral-700 font-mono text-xs text-neutral-100"
                    />
                  </div>

                  {/* Author Filter */}
                  <div className="space-y-1">
                    <label htmlFor="author-npub-iframe" className="text-xs font-mono text-neutral-500 uppercase tracking-wide">
                      Authors
                    </label>
                    <Input
                      id="author-npub-iframe"
                      type="text"
                      placeholder="npub1..."
                      value={authorNpub}
                      onChange={(e) => handleAuthorChange(e.target.value)}
                      className="h-8 bg-neutral-950 border-neutral-700 font-mono text-xs text-neutral-100"
                    />
                  </div>

                  {/* Kinds Filter */}
                  <div className="space-y-1">
                    <label className="text-xs font-mono text-neutral-500 uppercase tracking-wide">
                      Kinds
                    </label>
                    <div className="flex gap-1.5">
                      <div className="flex-1 relative">
                        <Input
                          type="text"
                          placeholder="Search..."
                          value={kindSearchQuery}
                          onChange={(e) => {
                            setKindSearchQuery(e.target.value);
                            setShowKindDropdown(true);
                          }}
                          onFocus={() => setShowKindDropdown(true)}
                          onBlur={() => setTimeout(() => setShowKindDropdown(false), 200)}
                          className="h-8 bg-neutral-950 border-neutral-700 font-mono text-xs text-neutral-100"
                        />
                        {showKindDropdown && kindSearchQuery && filteredCommonKinds.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 bg-neutral-900 border border-neutral-700 rounded-md shadow-xl max-h-48 overflow-y-auto">
                            {filteredCommonKinds.map((kind) => (
                              <button
                                key={kind.value}
                                onClick={() => handleAddKind(kind.value)}
                                className="w-full text-left px-3 py-2 hover:bg-neutral-800 text-xs font-mono flex items-center justify-between text-neutral-300"
                              >
                                <span>{kind.label}</span>
                                <span className="text-neutral-500">{kind.value}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <Input
                        type="number"
                        placeholder="#"
                        value={customKind}
                        onChange={(e) => setCustomKind(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCustomKind()}
                        className="h-8 w-12 bg-neutral-950 border-neutral-700 font-mono text-xs text-center text-neutral-100"
                        min="0"
                      />
                      <Button
                        onClick={handleAddCustomKind}
                        disabled={!customKind || isNaN(parseInt(customKind))}
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 font-mono text-xs border-neutral-700"
                      >
                        +
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Selected Kinds Pills */}
                {selectedKinds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-neutral-800">
                    {selectedKinds.sort((a, b) => a - b).map((kind) => (
                      <button
                        key={kind}
                        onClick={() => handleRemoveKind(kind)}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-xs font-mono text-neutral-300 transition-colors"
                      >
                        <span className="text-neutral-500">{kind}</span>
                        <span className="text-neutral-600">·</span>
                        <span>{COMMON_KINDS.find(k => k.value === kind)?.label || 'Custom'}</span>
                        <X className="h-3 w-3 ml-0.5 text-neutral-500" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Events Display - Fibonacci ratio columns (5:8) */}
        {(isConnected || isConnecting) && (
          <div className="grid grid-cols-13 gap-4">
            {/* Left Column - Events List (5 parts) */}
            <div className={`col-span-5 bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden ${iframeMode ? 'h-[calc(100vh-120px)]' : 'h-[calc(100vh-340px)]'}`}>
              <div className="flex flex-col h-full">
                <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
                  <div className="flex items-center justify-between">
                    <h2 className="font-mono text-xs uppercase tracking-wider text-neutral-400">
                      Events
                    </h2>
                    <span className="font-mono text-xs text-neutral-500">
                      {events.length}
                    </span>
                  </div>
                </div>
                <div className="overflow-y-auto flex-1">
                  {events.length === 0 ? (
                    <div className="p-8 text-center">
                      <p className="text-xs font-mono text-neutral-600">Listening for events...</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-700">
                      {events.map((event) => (
                        <div
                          key={event.id}
                          className={`relative group ${
                            selectedEvent?.id === event.id
                              ? 'bg-zinc-700 border-l-2 border-zinc-400'
                              : ''
                          }`}
                        >
                          <button
                            onClick={() => setSelectedEvent(event)}
                            className="w-full text-left px-4 py-3 hover:bg-zinc-800/50 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-zinc-300">
                                <span className="text-zinc-400">kind</span>
                                <span className="text-zinc-200">{event.kind}</span>
                              </span>
                              <div className="text-right">
                                <div className="text-xs font-mono text-zinc-400">
                                  {new Date(event.created_at * 1000).toLocaleTimeString('en-US', { 
                                    hour12: false,
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                  })}
                                </div>
                                <div className="text-[10px] font-mono text-zinc-500">
                                  ({formatDistanceToNow(new Date(event.created_at * 1000), { addSuffix: true })})
                                </div>
                              </div>
                            </div>
                            <div className="text-xs font-mono text-zinc-400 truncate mb-1">
                              {event.id.substring(0, 32)}...
                            </div>
                            {event.content && (
                              <div className="text-xs text-zinc-300 truncate pr-8">
                                {event.content.substring(0, 60)}
                                {event.content.length > 60 ? '...' : ''}
                              </div>
                            )}
                          </button>
                          
                          {/* Delete button on hover - bottom right */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteEvent(event.id);
                            }}
                            className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-red-900/90 hover:bg-red-800 border border-red-700 rounded"
                            title="Delete event (kind 5)"
                          >
                            <Trash2 className="h-3 w-3 text-red-200" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column - Event Details (8 parts) */}
            <div className={`col-span-8 bg-neutral-900 border border-neutral-800 rounded-lg overflow-hidden ${iframeMode ? 'h-[calc(100vh-120px)]' : 'h-[calc(100vh-340px)]'}`}>
              <div className="flex flex-col h-full">
                <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur">
                  <h2 className="font-mono text-xs uppercase tracking-wider text-neutral-400">
                    Event Inspector
                  </h2>
                </div>
                <div className="overflow-y-auto flex-1 p-4">
                  {selectedEvent ? (
                    <pre className="text-xs font-mono text-neutral-300 leading-relaxed">
                      {JSON.stringify(selectedEvent, null, 2)}
                    </pre>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-xs font-mono text-neutral-600">Select an event to inspect</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        {!iframeMode && (
          <div className="mt-6 text-center">
            <a
              href="https://shakespeare.diy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-neutral-600 hover:text-neutral-500 transition-colors"
            >
              built with shakespeare
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
