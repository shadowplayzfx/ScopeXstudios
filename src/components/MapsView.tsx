import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Compass, ExternalLink, Loader2, MapPin, Navigation, Search, Sparkles } from 'lucide-react';
import type { MapsGroundingResponse } from '../types/studio';
import { MarkdownView } from './MarkdownView';

interface MapsViewProps {
  initialQuery?: string;
  onActivityLog?: (label: string, detail: string, status?: 'completed' | 'error') => void;
}

interface SelectedMapPlace {
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
  websiteURI?: string;
}

function isQuotaErrorText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    text.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('over_query_limit') ||
    lower.includes('overquota') ||
    lower.includes('quota')
  );
}

interface PlacesSuggestionItem {
  placePrediction?: {
    text?: { text?: string };
    toPlace: () => {
      displayName?: string;
      formattedAddress?: string;
      location?: { lat: () => number; lng: () => number } | null;
      viewport?: unknown;
      rating?: number | null;
      websiteURI?: string | null;
      fetchFields: (opts: { fields: string[] }) => Promise<void>;
    };
  };
}

interface PlacesLibraryCompat {
  AutocompleteSessionToken: new () => unknown;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (request: {
      input: string;
      sessionToken?: unknown;
      locationBias?: {
        center: { lat: number; lng: number };
        radius: number;
      };
    }) => Promise<{ suggestions?: PlacesSuggestionItem[] }>;
  };
}

interface PlacesSearchBarProps {
  onSelectPlace: (place: SelectedMapPlace) => void;
}

const PlacesSearchBar: React.FC<PlacesSearchBarProps> = ({ onSelectPlace }) => {
  const placesLib = useMapsLibrary('places') as PlacesLibraryCompat | null;
  const map = useMap();
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<PlacesSuggestionItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [placeError, setPlaceError] = useState('');
  const sessionTokenRef = useRef<unknown>(null);

  useEffect(() => {
    if (!placesLib || !inputValue.trim()) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setSearching(true);
        setPlaceError('');
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        const center = map?.getCenter();
        const request = {
          input: inputValue.trim(),
          sessionToken: sessionTokenRef.current,
          ...(center
            ? {
                locationBias: {
                  center: { lat: center.lat(), lng: center.lng() },
                  radius: 30000,
                },
              }
            : {}),
        };
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
        if (!cancelled) {
          setSuggestions(res?.suggestions || []);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isQuotaErrorText(msg)) {
          window.dispatchEvent(new Event('gmp-quota-exceeded'));
        }
        if (!cancelled) {
          setSuggestions([]);
          setPlaceError(msg);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 240);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [inputValue, map, placesLib]);

  const handleChooseSuggestion = useCallback(
    async (suggestion: PlacesSuggestionItem) => {
      if (!placesLib || !suggestion.placePrediction) return;
      try {
        const place = suggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: [
            'displayName',
            'formattedAddress',
            'location',
            'viewport',
            'rating',
            'websiteURI',
          ],
        });

        sessionTokenRef.current = null;
        setSuggestions([]);
        setInputValue(place.displayName || suggestion.placePrediction.text?.text || '');

        const loc = place.location;
        if (loc) {
          const coords = { lat: loc.lat(), lng: loc.lng() };
          if (place.viewport && map) {
            (map as { fitBounds: (b: unknown) => void }).fitBounds(place.viewport);
          } else if (map) {
            map.panTo(coords);
            map.setZoom(14);
          }
          onSelectPlace({
            name: place.displayName || 'Selected Location',
            address: place.formattedAddress || '',
            lat: coords.lat,
            lng: coords.lng,
            rating: typeof place.rating === 'number' ? place.rating : undefined,
            websiteURI: place.websiteURI || undefined,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isQuotaErrorText(msg)) {
          window.dispatchEvent(new Event('gmp-quota-exceeded'));
        }
        setPlaceError(msg);
      }
    },
    [map, onSelectPlace, placesLib]
  );

  return (
    <div className="relative">
      <div className="relative flex items-center">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Search places, landmarks, or addresses..."
          className="w-full bg-[#07090E] border border-white/10 focus:border-blue-500 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none"
        />
        {searching && (
          <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin absolute right-3" />
        )}
      </div>

      {placeError && (
        <div className="mt-1.5 text-[11px] text-amber-300">{placeError}</div>
      )}

      {suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-[#0D1119] border border-white/15 rounded-xl overflow-hidden shadow-xl max-h-60 overflow-y-auto">
          {suggestions.map((sug, idx) => {
            const label = sug.placePrediction?.text?.text || 'Place result';
            return (
              <li key={idx}>
                <button
                  type="button"
                  onClick={() => void handleChooseSuggestion(sug)}
                  className="w-full text-left px-3.5 py-2.5 text-xs text-slate-200 hover:bg-blue-600/20 border-b border-white/[0.05] last:border-b-0 flex items-center gap-2"
                >
                  <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

interface InteractiveMarkerProps {
  place: SelectedMapPlace;
}

const InteractiveMarker: React.FC<InteractiveMarkerProps> = ({ place }) => {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setOpen(true);
  }, [place.lat, place.lng, place.name]);

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={{ lat: place.lat, lng: place.lng }}
        onClick={() => setOpen(true)}
        title={place.name}
      >
        <Pin background="#3b82f6" borderColor="#1d4ed8" glyphColor="#ffffff" />
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow
          anchor={marker}
          maxWidth={260}
          onCloseClick={() => setOpen(false)}
        >
          <div className="text-slate-900 space-y-1 p-0.5">
            <div className="font-semibold text-xs">{place.name}</div>
            {place.address && (
              <div className="text-[11px] text-slate-600">{place.address}</div>
            )}
            {typeof place.rating === 'number' && (
              <div className="text-[11px] font-medium text-amber-700">
                Rating: {place.rating.toFixed(1)} / 5
              </div>
            )}
            {place.websiteURI && (
              <a
                href={place.websiteURI}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-[11px] text-blue-600 underline"
              >
                Visit website
              </a>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
};

export const MapsView: React.FC<MapsViewProps> = ({
  initialQuery = '',
  onActivityLog,
}) => {
  const envKey = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  const [mapsApiKey, setMapsApiKey] = useState(
    envKey && envKey !== 'MY_GOOGLE_MAPS_API_KEY' ? envKey : ''
  );
  const [loadingConfig, setLoadingConfig] = useState(!mapsApiKey);

  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({
    lat: 37.7749,
    lng: -122.4194,
  });
  const [selectedPlace, setSelectedPlace] = useState<SelectedMapPlace | null>({
    name: 'San Francisco',
    address: 'California, United States',
    lat: 37.7749,
    lng: -122.4194,
  });

  const [groundQuery, setGroundQuery] = useState(initialQuery);
  const [groundingLoading, setGroundingLoading] = useState(false);
  const [groundingError, setGroundingError] = useState('');
  const [groundingResult, setGroundingResult] = useState<MapsGroundingResponse | null>(null);

  useEffect(() => {
    if (mapsApiKey) {
      setLoadingConfig(false);
      return;
    }
    let active = true;
    fetch('/api/maps/config')
      .then((res) => res.json())
      .then((data: { apiKey?: string }) => {
        if (active && data.apiKey) {
          setMapsApiKey(data.apiKey);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoadingConfig(false);
      });
    return () => {
      active = false;
    };
  }, [mapsApiKey]);

  const runMapsGrounding = useCallback(
    async (queryText: string) => {
      const q = queryText.trim();
      if (!q || groundingLoading) return;
      setGroundingLoading(true);
      setGroundingError('');
      try {
        const res = await fetch('/api/maps/ground', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: q,
            lat: mapCenter.lat,
            lng: mapCenter.lng,
          }),
        });
        if (res.status === 429) {
          window.dispatchEvent(new Event('gmp-quota-exceeded'));
        }
        const data = (await res.json()) as MapsGroundingResponse & { error?: string };
        if (!res.ok || data.error) {
          const msg = data.error || `Maps grounding HTTP ${res.status}`;
          if (isQuotaErrorText(msg)) {
            window.dispatchEvent(new Event('gmp-quota-exceeded'));
          }
          throw new Error(msg);
        }
        setGroundingResult(data);
        onActivityLog?.('Maps Grounding', `${q} (${data.places.length} places)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Maps grounding failed.';
        setGroundingError(msg);
        onActivityLog?.('Maps Grounding Error', msg, 'error');
      } finally {
        setGroundingLoading(false);
      }
    },
    [groundingLoading, mapCenter.lat, mapCenter.lng, onActivityLog]
  );

  useEffect(() => {
    if (initialQuery && initialQuery !== groundQuery) {
      setGroundQuery(initialQuery);
      void runMapsGrounding(initialQuery);
    }
  }, [initialQuery]);

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        setMapCenter(coords);
        setSelectedPlace({
          name: 'Current Location',
          address: `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`,
          lat: coords.lat,
          lng: coords.lng,
        });
      },
      () => undefined,
      { timeout: 6000 }
    );
  };

  return (
    <div className="h-full flex flex-col lg:grid lg:grid-cols-[1.2fr_0.95fr] overflow-hidden">
      {/* Interactive Google Map Canvas */}
      <div className="relative flex-1 min-h-[380px] h-full flex flex-col border-b lg:border-b-0 lg:border-r border-white/[0.08] bg-[#07090E]">
        {loadingConfig ? (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-400 gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            Loading Google Maps configuration...
          </div>
        ) : !mapsApiKey ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
            <Compass className="w-9 h-9 text-blue-400" />
            <h3 className="font-display text-base font-semibold text-white">
              Google Maps API Key Not Active Yet
            </h3>
            <p className="text-xs text-slate-400 max-w-md leading-relaxed">
              The interactive map renders as soon as <code className="text-slate-200">VITE_GOOGLE_MAPS_API_KEY</code> (or <code className="text-slate-200">GOOGLE_MAPS_API_KEY</code>) is active in runtime secrets. Gemini Maps Grounding on the right remains ready.
            </p>
          </div>
        ) : (
          <APIProvider apiKey={mapsApiKey} libraries={['places', 'marker']}>
            <div className="p-3 bg-[#0A0D14] border-b border-white/[0.08] flex items-center gap-2.5 z-20">
              <div className="flex-1">
                <PlacesSearchBar
                  onSelectPlace={(p) => {
                    setSelectedPlace(p);
                    setMapCenter({ lat: p.lat, lng: p.lng });
                    onActivityLog?.('Map Place Selected', p.name);
                  }}
                />
              </div>
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                title="Center on my location"
                className="p-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 shrink-0"
              >
                <Navigation className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-[340px] w-full relative">
              <GoogleMap
                mapId="DEMO_MAP_ID"
                defaultCenter={mapCenter}
                center={mapCenter}
                defaultZoom={12}
                gestureHandling="greedy"
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                onCameraChanged={(ev) => {
                  const c = ev.detail.center;
                  if (c) setMapCenter({ lat: c.lat, lng: c.lng });
                }}
              >
                {selectedPlace && <InteractiveMarker place={selectedPlace} />}
              </GoogleMap>
            </div>
          </APIProvider>
        )}
      </div>

      {/* Gemini Maps Grounding Explorer */}
      <div className="flex flex-col h-full overflow-hidden bg-[#0A0D14]">
        <div className="p-4 border-b border-white/[0.08] space-y-3 shrink-0">
          <div>
            <h2 className="font-display text-base font-bold text-white flex items-center gap-2">
              <Compass className="w-4 h-4 text-blue-400" />
              Maps Intelligence & Grounding
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Ask location questions backed by live Google Maps place & review grounding (gemini-4-hydrogen).
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runMapsGrounding(groundQuery);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={groundQuery}
              onChange={(e) => setGroundQuery(e.target.value)}
              placeholder="e.g., Quiet artisan coffee shops near Golden Gate Park..."
              className="flex-1 bg-[#07090E] border border-white/10 focus:border-blue-500 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={groundingLoading || !groundQuery.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0"
            >
              {groundingLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              Explore
            </button>
          </form>

          <div className="flex flex-wrap gap-1.5">
            {[
              'Best specialty coffee shops nearby',
              'EV fast charging stations near downtown',
              'Scenic waterfront walking trails',
            ].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => {
                  setGroundQuery(sample);
                  void runMapsGrounding(sample);
                }}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-[#07090E] border border-white/[0.07] hover:border-blue-500/40 text-slate-400 hover:text-slate-200 transition-colors"
              >
                {sample}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {groundingError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300">
              {groundingError}
            </div>
          )}

          {groundingLoading ? (
            <div className="py-12 text-center space-y-2 text-xs text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-blue-400 mx-auto" />
              <div>Querying Google Maps grounded places...</div>
            </div>
          ) : groundingResult ? (
            <>
              <div className="bg-[#0D1119] border border-white/10 rounded-xl p-4">
                <MarkdownView content={groundingResult.markdown} />
              </div>

              {groundingResult.places.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-medium text-slate-300">
                    Grounded Google Maps Places ({groundingResult.places.length})
                  </div>
                  {groundingResult.places.map((pl, idx) => (
                    <div
                      key={`${pl.uri}_${idx}`}
                      className="bg-[#0D1119] border border-white/10 rounded-xl p-3.5 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span>{pl.title}</span>
                        </div>
                        <a
                          href={pl.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 whitespace-nowrap shrink-0"
                        >
                          Google Maps
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      {pl.reviewSnippets && pl.reviewSnippets.length > 0 && (
                        <div className="space-y-1 border-l-2 border-blue-500/30 pl-2.5">
                          {pl.reviewSnippets.slice(0, 2).map((snip, sIdx) => (
                            <p key={sIdx} className="text-[11px] text-slate-400 leading-relaxed">
                              “{snip}”
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="py-12 text-center space-y-2">
              <MapPin className="w-7 h-7 text-slate-500 mx-auto" />
              <p className="text-xs text-slate-400">
                Search for a location on the map or ask for grounded local recommendations above.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
