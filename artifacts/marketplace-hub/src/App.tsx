import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Bookmark, Camera, CheckCircle2, ChevronDown, CircleAlert, Heart, Home, ImagePlus, Laptop,
  MapPin, MessageCircle, Package, Plus, RefreshCw, Search, Send, Share2, ShieldCheck, SlidersHorizontal,
  Store, Tag, Users, X, Zap, Video,
} from 'lucide-react';
import {
  type MarketplacePost, type MarketplacePostInput, type StoredMedia,
  getHealthCheckQueryKey, getListMarketplaceAdminPostsQueryKey, getListMarketplacePostsQueryKey,
  getSearchLocationsQueryKey,
  useCreateMarketplacePost, useHealthCheck, useListMarketplaceAdminPosts, useListMarketplacePosts,
  useModerateMarketplacePost, useRequestMediaUploadUrl, useSearchLocations,
} from '@workspace/api-client-react';
import { Router as WouterRouter, useLocation } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

type Category = 'All' | 'Fashion' | 'Tech' | 'Home' | 'Vehicles' | 'Services' | 'Documents';
type PostType = 'For sale';
type ImagePreview = StoredMedia & { file?: File };
type VideoPreview = StoredMedia & { file?: File };
type Listing = Omit<MarketplacePost, 'images' | 'video'> & { images: ImagePreview[]; video?: VideoPreview | null };
type CommunityPost = { id: string; author: string; initials: string; time: string; text: string; likes: number; comments: number; shares: number; liked?: boolean; saved?: boolean; images: ImagePreview[] };
type LocationLevel = 'City' | 'Municipality' | 'Barangay' | 'Locality';
type LocationSuggestion = { value: string; label: string; level: Exclude<LocationLevel, 'Locality'>; parent?: string };

const categories: Category[] = ['All', 'Fashion', 'Tech', 'Home', 'Vehicles', 'Services', 'Documents'];
const fallbackLocations = ['All Philippines', 'Makati', 'Quezon City', 'Pasig', 'Marikina City', 'Taguig', 'Mandaluyong', 'Cebu City', 'Davao City', 'Iloilo City', 'Baguio City', 'Cagayan de Oro'];
const tileStyles: Record<string, React.CSSProperties> = {
  Fashion: { '--tile-bg': 'hsl(15 70% 88%)', '--tile-fg': 'hsl(15 55% 32%)' } as React.CSSProperties,
  Tech: { '--tile-bg': 'hsl(178 36% 85%)', '--tile-fg': 'hsl(178 58% 26%)' } as React.CSSProperties,
  Home: { '--tile-bg': 'hsl(39 60% 84%)', '--tile-fg': 'hsl(37 57% 30%)' } as React.CSSProperties,
  Vehicles: { '--tile-bg': 'hsl(196 44% 86%)', '--tile-fg': 'hsl(195 54% 29%)' } as React.CSSProperties,
  Services: { '--tile-bg': 'hsl(268 30% 89%)', '--tile-fg': 'hsl(268 35% 37%)' } as React.CSSProperties,
  Documents: { '--tile-bg': 'hsl(52 56% 85%)', '--tile-fg': 'hsl(42 65% 32%)' } as React.CSSProperties,
};
const categoryIcons: Record<string, typeof Tag> = { Fashion: Tag, Tech: Laptop, Home, Vehicles: Zap, Services: Users, Documents: Package };
const seededListings: Listing[] = [];
const seededPosts: CommunityPost[] = [
  {
    id: 'community-fair-price',
    author: 'Ina D.',
    initials: 'ID',
    time: '18 min',
    text: 'Looking for a fair price on a pre-loved dining set in good condition. If you are clearing space before the holidays, I would love to see what you have around Marikina.',
    likes: 14,
    comments: 4,
    shares: 2,
    images: [],
  },
  {
    id: 'community-local-maker',
    author: 'Paolo M.',
    initials: 'PM',
    time: '1 hr',
    text: 'A small reminder to ask where things are made. Found an excellent handwoven tote from an Ilocos maker today, and the story made the purchase feel even better.',
    likes: 28,
    comments: 6,
    shares: 9,
    liked: true,
    images: [],
  },
  {
    id: 'community-pickup',
    author: 'Celine R.',
    initials: 'CR',
    time: '3 hrs',
    text: 'What is everyone’s safest meetup spot in Cebu City? I am buying my first item here and would appreciate local advice before I confirm.',
    likes: 9,
    comments: 5,
    shares: 1,
    images: [],
  },
];
const money = (value: number) => `₱${value.toLocaleString('en-PH')}`;
const nameInitials = (name: string) => name.split(' ').map((word) => word[0]).slice(0, 2).join('').toUpperCase();
const apiMediaUrl = (objectPath: string) => `/api/storage${objectPath}`;
const listingFromApi = (item: MarketplacePost): Listing => ({
  ...item, price: Number(item.price), likes: item.likes ?? 0, comments: item.comments ?? 0, shares: item.shares ?? 0,
  saved: item.saved ?? false, liked: item.liked ?? false,
  images: (item.images ?? []).map((image) => ({ ...image, url: image.objectPath ? apiMediaUrl(image.objectPath) : image.url })),
  video: item.video ? { ...item.video, url: item.video.objectPath ? apiMediaUrl(item.video.objectPath) : item.video.url } : null,
});

const queryClient = new QueryClient();

function MarketplaceApp() {
  const [location, setLocation] = useLocation();
  const { user, isLoading: authLoading, isAuthenticated, login, logout } = useAuth();
  const view = location === '/saved' ? 'saved' : location === '/marketplace' ? 'marketplace' : 'home';
  const { data: apiListings, isLoading, isError: listingsError, refetch: refetchListings } = useListMarketplacePosts({
    query: { queryKey: getListMarketplacePostsQueryKey() },
  });
  useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 60_000 } });
  const createPost = useCreateMarketplacePost();
  const requestUpload = useRequestMediaUploadUrl();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('All');
  const [area, setArea] = useState('All Philippines');
  const [sort, setSort] = useState('recommended');
  const [listings, setListings] = useState< Listing[]>(seededListings);
  const [posts, setPosts] = useState(seededPosts);
  const [locations, setLocations] = useState(fallbackLocations);
  const [selected, setSelected] = useState<Listing | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [toast, setToast] = useState('');
  const adminPosts = useListMarketplaceAdminPosts({
    query: { enabled: moderationOpen, queryKey: getListMarketplaceAdminPostsQueryKey() },
  });
  const moderatePost = useModerateMarketplacePost();
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2400); };
  const beginCreate = () => {
    if (authLoading) {
      notify('Checking your sign-in status. Try again in a moment.');
      return;
    }
    if (!isAuthenticated) {
      login();
      return;
    }
    setCreateOpen(true);
  };
  const accountLabel = user?.firstName?.trim() || 'Account';
  const accountInitials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase() || 'U';
  useEffect(() => {
    if (apiListings) {
      setListings((current) => {
        const incoming = [...seededListings, ...apiListings.map(listingFromApi)];
        return incoming.map((item) => {
          const previous = current.find((entry) => entry.id === item.id);
          return previous ? { ...item, saved: previous.saved, liked: previous.liked, likes: previous.likes } : item;
        });
      });
    }
  }, [apiListings]);
  const filteredListings = useMemo(() => {
    const normalized = query.toLowerCase();
    const selectedAreaName = area.split(' · ')[0];
    const result = listings.filter((item) => {
      return item.type === 'For sale'
        && (!normalized || `${item.title} ${item.seller} ${item.category}`.toLowerCase().includes(normalized))
        && (category === 'All' || item.category === category)
        && (area === 'All Philippines' || item.location === area || item.location === selectedAreaName || item.location.startsWith(`${selectedAreaName} ·`))
        && (view !== 'saved' || item.saved);
    });
    return [...result].sort((a, b) => sort === 'low' ? a.price - b.price : sort === 'high' ? b.price - a.price : b.likes - a.likes);
  }, [area, category, listings, query, sort, view]);
  const updateListing = (id: string, patch: Partial<Listing>) => setListings((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const toggleSaved = (id: string) => { const item = listings.find((entry) => entry.id === id); updateListing(id, { saved: !item?.saved }); notify(item?.saved ? 'Removed from your saved shelf.' : 'Saved for later.'); };
  const toggleLiked = (id: string) => { const item = listings.find((entry) => entry.id === id); if (item) updateListing(id, { liked: !item.liked, likes: item.likes + (item.liked ? -1 : 1) }); };
  const togglePost = (id: string, key: 'liked' | 'saved') => setPosts((items) => items.map((post) => post.id === id ? { ...post, [key]: !post[key], ...(key === 'liked' ? { likes: post.likes + (post.liked ? -1 : 1) } : {}) } : post));
  const publish = async (draft: MarketplacePostInput) => {
    const savedPost = await createPost.mutateAsync({ data: draft });
    queryClient.invalidateQueries({ queryKey: getListMarketplacePostsQueryKey() });
    setListings((items) => [listingFromApi(savedPost), ...items.filter((item) => item.id !== savedPost.id)]);
    setCreateOpen(false); setLocation('/marketplace'); setCategory('All'); setArea('All Philippines');
    notify('Your post is live publicly for buyers across the Philippines.');
  };
  const openMarketplace = () => { setLocation('/marketplace'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  return <div className="app-shell">
    <header className="topbar"><div className="topbar-inner">
      <button className="brand" onClick={() => setLocation('/')} data-testid="button-home"><span className="brand-mark">mm</span><span className="brand-word">media market<span>.</span></span></button>
      <div className="global-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search listings, sellers, categories" data-testid="input-global-search" /></div>
       <nav className="top-actions"><button className={`nav-btn ${view === 'home' ? 'active' : ''}`} onClick={() => setLocation('/')} data-testid="button-nav-feed"><Home size={16} /><span>Feed</span></button><button className={`nav-btn ${view === 'marketplace' ? 'active' : ''}`} onClick={openMarketplace} data-testid="button-nav-market"><Store size={16} /><span>Marketplace</span></button><button className={`nav-btn ${view === 'saved' ? 'active' : ''}`} onClick={() => setLocation('/saved')} data-testid="button-nav-saved"><Bookmark size={16} /><span>Saved</span></button><button className="nav-btn" onClick={isAuthenticated ? logout : login} disabled={authLoading} data-testid="button-auth">{isAuthenticated ? `${accountLabel} · Log out` : 'Log in'}</button><button className="avatar" onClick={() => { if (!isAuthenticated) { login(); return; } setModerationOpen(true); }} aria-label={isAuthenticated ? 'Open owner review' : 'Log in for owner tools'} data-testid="button-profile">{isAuthenticated ? accountInitials : 'MM'}</button></nav>
    </div></header>
       <main className="main-content container">{view === 'home' ? <HomeView posts={posts} onCreate={beginCreate} onBrowse={openMarketplace} onLike={(id) => togglePost(id, 'liked')} onSave={(id) => togglePost(id, 'saved')} onComment={(id, text) => { setPosts((items) => items.map((post) => post.id === id ? { ...post, comments: post.comments + 1, text: `${post.text}\n\nYou: ${text}` } : post)); notify('Comment added to the conversation.'); }} /> : <MarketplaceView listings={filteredListings} locations={locations} loading={isLoading} apiError={listingsError} onRetry={() => { void refetchListings(); }} view={view} query={query} category={category} location={area} sort={sort} onQuery={setQuery} onCategory={setCategory} onLocation={setArea} onSort={setSort} onCreate={beginCreate} onOpen={setSelected} onSave={toggleSaved} onLike={toggleLiked} onClear={() => { setQuery(''); setCategory('All'); setArea('All Philippines'); }} />}</main>
     <nav className="mobile-nav"><button className={view === 'home' ? 'active' : ''} onClick={() => setLocation('/')} data-testid="mobile-nav-feed"><Home size={18} /><span>Feed</span></button><button className={view === 'marketplace' ? 'active' : ''} onClick={openMarketplace} data-testid="mobile-nav-market"><Store size={18} /><span>Market</span></button><button onClick={beginCreate} data-testid="mobile-nav-create"><Plus size={20} /><span>Post</span></button><button className={view === 'saved' ? 'active' : ''} onClick={() => setLocation('/saved')} data-testid="mobile-nav-saved"><Bookmark size={18} /><span>Saved</span></button></nav>
    {selected && <ListingModal listing={selected} onClose={() => setSelected(null)} onSave={() => { toggleSaved(selected.id); setSelected((item) => item ? { ...item, saved: !item.saved } : null); }} onLike={() => { toggleLiked(selected.id); setSelected((item) => item ? { ...item, liked: !item.liked, likes: item.likes + (item.liked ? -1 : 1) } : null); }} onNotify={notify} />}
      {createOpen && <CreateModal onClose={() => setCreateOpen(false)} onPublish={publish} requestUpload={requestUpload.mutateAsync} />}
     {moderationOpen && <ModerationModal posts={adminPosts.data ?? []} loading={adminPosts.isLoading} error={adminPosts.isError} submitting={moderatePost.isPending} onClose={() => setModerationOpen(false)} onRetry={() => { void adminPosts.refetch(); }} onModerate={async (id, status, note) => { await moderatePost.mutateAsync({ id, data: { status, note: note || null } }); await queryClient.invalidateQueries({ queryKey: getListMarketplaceAdminPostsQueryKey() }); await queryClient.invalidateQueries({ queryKey: getListMarketplacePostsQueryKey() }); notify(status === 'approved' ? 'Listing approved and visible in the market.' : 'Listing returned to the owner.'); }} />}
    {toast && <div className="toast-note" role="status" data-testid="status-toast">{toast}</div>}
  </div>;
}

function HomeView({ posts, onCreate, onBrowse, onLike, onSave, onComment }: { posts: CommunityPost[]; onCreate: () => void; onBrowse: () => void; onLike: (id: string) => void; onSave: (id: string) => void; onComment: (id: string, text: string) => void }) {
  return <><section className="hero-card"><div className="hero-copy"><p className="eyebrow">The Philippines, made for everyone</p><h1>Buy local. Sell proudly. Grow nationwide.</h1><p>Isang nationwide buy and sell marketplace para sa lahat ng Pilipino—makahanap ng de-kalidad na produktong gawa sa Pilipinas, suportahan ang local sellers, at makakonekta sa buyers mula Luzon hanggang Mindanao.</p></div><button className="button-primary" onClick={onBrowse} data-testid="button-browse-market"><Store size={16} /> Browse market</button></section><div className="section-head"><div><p className="eyebrow">The community noticeboard</p><h2>What people are talking about</h2></div><button className="button-secondary" onClick={onCreate} data-testid="button-create-post"><Plus size={15} /> Create a post</button></div><div className="feed-layout"><div><div className="surface composer"><span className="avatar">YC</span><button onClick={onCreate} data-testid="button-composer">Share a find, ask around, or list an item...</button><Camera size={17} color="hsl(var(--muted-foreground))" /></div>{posts.map((post) => <CommunityPostCard key={post.id} post={post} onLike={() => onLike(post.id)} onSave={() => onSave(post.id)} onComment={(text) => onComment(post.id, text)} />)}</div><aside className="home-side"><div className="surface side-card pulse-card"><p className="eyebrow">A better way to browse</p><h3>Good finds move through good communities.</h3><p className="side-caption">Ask a neighbor. Share the useful details. Meet in a place that feels right.</p><div className="pulse-stat"><strong>Across Luzon, Visayas & Mindanao</strong><span>One marketplace, many local rhythms.</span></div></div><div className="surface side-card"><h3>Keep it neighborly</h3><TrustRow icon={<ShieldCheck size={17} />} title="Trust the details" text="Read the description, check the seller, and ask before you buy." /><TrustRow icon={<MapPin size={17} />} title="Meet with care" text="Choose a public place and keep your plans clear." /></div></aside></div></>;
}
function TrustRow({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="trust-row">{icon}<div><strong>{title}</strong><span>{text}</span></div></div>; }
function CommunityPostCard({ post, onLike, onSave, onComment }: { post: CommunityPost; onLike: () => void; onSave: () => void; onComment: (text: string) => void }) {
  const [comment, setComment] = useState('');
  const submitComment = (event: FormEvent) => { event.preventDefault(); if (comment.trim()) { onComment(comment.trim()); setComment(''); } };
  return <article className="surface post-card" data-testid={`card-post-${post.id}`}><div className="post-head"><span className="avatar">{post.initials}</span><div className="post-author"><strong>{post.author}</strong><span>{post.time} ago · Philippines</span></div><button className="icon-btn" onClick={() => navigator.clipboard?.writeText(post.text)} aria-label="Copy post text" data-testid={`button-more-post-${post.id}`}><SlidersHorizontal size={15} /></button></div><p className="post-copy" data-testid={`text-post-${post.id}`}>{post.text}</p><div className="post-actions"><button className={`post-action ${post.liked ? 'liked' : ''}`} onClick={onLike} data-testid={`button-like-post-${post.id}`}><Heart size={15} fill={post.liked ? 'currentColor' : 'none'} /> {post.likes}</button><button className="post-action" onClick={() => document.getElementById(`comment-${post.id}`)?.focus()} data-testid={`button-comment-post-${post.id}`}><MessageCircle size={15} /> {post.comments}</button><button className="post-action" onClick={() => navigator.clipboard?.writeText(window.location.href)} data-testid={`button-share-post-${post.id}`}><Share2 size={15} /> {post.shares}</button><button className={`post-action ${post.saved ? 'saved' : ''}`} onClick={onSave} data-testid={`button-save-post-${post.id}`}><Bookmark size={15} fill={post.saved ? 'currentColor' : 'none'} /></button></div><form className="comment-form" onSubmit={submitComment}><input id={`comment-${post.id}`} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add to the conversation" data-testid={`input-comment-${post.id}`} /><button type="submit" aria-label="Send comment" data-testid={`button-send-comment-${post.id}`}><Send size={14} /></button></form></article>;
}
function LocationAutocomplete({ level, value, parent, label, placeholder, onChange, disabled = false, testId }: { level: LocationLevel; value: string; parent?: string; label: string; placeholder: string; onChange: (value: string) => void; disabled?: boolean; testId: string }) {
  const [open, setOpen] = useState(false);
  const query = value.trim();
  const params = useMemo(() => ({ q: query.length >= 2 ? query : 'ph', level: level === 'Locality' ? undefined : level, parent }), [level, parent, query]);
  const locationsQuery = useSearchLocations(params, {
    query: {
      enabled: !disabled && query.length >= 2,
      queryKey: getSearchLocationsQueryKey(params),
      staleTime: 120_000,
    },
  });
  const suggestions = (locationsQuery.data?.locations ?? []) as LocationSuggestion[];
  const searching = locationsQuery.isFetching;

  return <div className={`location-autocomplete ${disabled ? 'is-disabled' : ''}`}>
    <label htmlFor={testId}>{label}</label>
    <div className="location-input-wrap">
      <ChevronDown className="location-chevron" size={15} aria-hidden="true" />
      <input
        id={testId}
        value={value}
        disabled={disabled}
         onFocus={() => suggestions.length > 0 && setOpen(true)}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
         placeholder={placeholder}
        autoComplete="off"
        data-testid={testId}
      />
      {searching && <span className="location-searching">Loading…</span>}
    </div>
    {open && suggestions.length > 0 && <div className="location-suggestions" role="listbox">
      {suggestions.map((suggestion) => <button
        type="button"
        className="location-suggestion"
        key={`${suggestion.level}-${suggestion.value}-${suggestion.parent ?? ''}`}
        onMouseDown={(event) => event.preventDefault()}
         data-testid={`location-suggestion-${suggestion.value}`}
         onClick={() => { onChange(suggestion.value); setOpen(false); }}
        role="option"
      >
        <MapPin size={13} />
        <span><strong>{suggestion.value}</strong><small>{suggestion.label}</small></span>
      </button>)}
    </div>}
  </div>;
}

function MarketplaceView({ listings, locations, loading, apiError, onRetry, view, query, category, location, sort, onQuery, onCategory, onLocation, onSort, onCreate, onOpen, onSave, onLike, onClear }: { listings: Listing[]; locations: string[]; loading: boolean; apiError: boolean; onRetry: () => void; view: 'marketplace' | 'saved'; query: string; category: Category; location: string; sort: string; onQuery: (value: string) => void; onCategory: (value: Category) => void; onLocation: (value: string) => void; onSort: (value: string) => void; onCreate: () => void; onOpen: (listing: Listing) => void; onSave: (id: string) => void; onLike: (id: string) => void; onClear: () => void }) {
  return <div className="page-grid"><div><div className="section-head" style={{ marginTop: 0 }}><div><p className="eyebrow">{view === 'saved' ? 'Your shortlist' : 'Bili, benta, discover'}</p><h1 className="page-title">{view === 'saved' ? 'Saved for later' : 'Marketplace'}</h1><p className="page-subtitle">{view === 'saved' ? 'Keep the good ones close while you decide.' : 'A nationwide marketplace for Philippine sellers and buyers. Discover domestic products, browse quickly, ask freely, and meet safely.'}</p></div><button className="button-primary" onClick={onCreate} data-testid="button-market-create"><Plus size={16} /> Post an item</button></div>{apiError && <div className="api-notice" role="status" data-testid="status-marketplace-fallback"><CircleAlert size={16} /><span><strong>Showing local finds</strong> We could not reach the live marketplace just now.</span><button className="button-ghost" onClick={onRetry} data-testid="button-retry-marketplace">Try again</button></div>}<div className="market-toolbar"><div className="global-search"><Search size={16} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search products, sellers, categories" data-testid="input-market-search" /></div><select className="select-control" value={sort} onChange={(event) => onSort(event.target.value)} aria-label="Sort listings" data-testid="select-sort-listings"><option value="recommended">Recommended</option><option value="low">Lowest price</option><option value="high">Highest price</option></select><button className="icon-btn refresh-button" onClick={onRetry} aria-label="Refresh marketplace listings" title="Refresh listings" data-testid="button-refresh-marketplace"><RefreshCw size={16} /></button></div><div className="filter-row">{categories.map((item) => <button className={`filter-chip ${category === item ? 'active' : ''}`} key={item} onClick={() => onCategory(item)} data-testid={`filter-${item.toLowerCase()}`}>{item}</button>)}</div>{loading ? <div className="listing-grid"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : listings.length === 0 ? <div className="surface empty-state"><div className="empty-icon"><Search size={20} /></div><strong>{view === 'saved' ? 'Your saved shelf is clear' : 'No listings yet'}</strong><p>{view === 'saved' ? 'Tap the bookmark on a find you want to come back to.' : 'There are no marketplace listings yet. Post an item when you are ready to add one.'}</p><button className="button-secondary" onClick={onClear} data-testid="button-clear-filters">Clear filters</button></div> : <div className="listing-grid">{listings.map((listing) => <ListingCard listing={listing} key={listing.id} onOpen={() => onOpen(listing)} onSave={() => onSave(listing.id)} onLike={() => onLike(listing.id)} />)}</div>}</div><aside className="side-stack"><div className="surface side-card"><h3>Filter by area</h3><p className="side-caption">Search a city or bayan instead of scrolling through all locations.</p><LocationAutocomplete level="Locality" value={location === 'All Philippines' ? '' : location} label="City or bayan" placeholder="Type at least 2 letters" onChange={(value) => onLocation(value || 'All Philippines')} testId="input-location-filter" />{location !== 'All Philippines' && <button className="button-ghost location-clear" onClick={() => onLocation('All Philippines')} type="button">Clear area</button>}</div><div className="surface side-card"><h3>Posting is simple</h3><TrustRow icon={<ImagePlus size={17} />} title="Show the real thing" text="Add clear photos so buyers know what to expect." /><TrustRow icon={<MessageCircle size={17} />} title="Stay curious" text="Ask a question before you commit." /></div></aside></div>;
}
function ListingCard({ listing, onOpen, onSave, onLike }: { listing: Listing; onOpen: () => void; onSave: () => void; onLike: () => void }) {
  const Icon = categoryIcons[listing.category] ?? Package;
  return <article className="surface listing-card" data-testid={`card-listing-${listing.id}`}><div className="listing-visual" style={tileStyles[listing.category]} onClick={onOpen} onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && (event.preventDefault(), onOpen())} role="button" tabIndex={0} aria-label={`Open ${listing.title}`} data-testid={`button-open-listing-${listing.id}`}>{listing.images[0] ? <img src={listing.images[0].url} alt={listing.title} /> : <span className="visual-symbol"><Icon size={27} /></span>}<span className="listing-condition">{listing.condition}</span><button className={`save-button ${listing.saved ? 'saved' : ''}`} onClick={(event) => { event.stopPropagation(); onSave(); }} aria-label={listing.saved ? 'Remove saved listing' : 'Save listing'} data-testid={`button-save-listing-${listing.id}`}><Bookmark size={15} fill={listing.saved ? 'currentColor' : 'none'} /></button></div><div className="listing-body"><div className="listing-price">{money(listing.price)}</div><h3 className="listing-title">{listing.title}</h3><div className="listing-meta"><span><MapPin size={12} /> {listing.location}</span><button className="like-inline" onClick={onLike} aria-label="Like listing" data-testid={`button-like-listing-${listing.id}`}><Heart size={12} fill={listing.liked ? 'currentColor' : 'none'} /> {listing.likes}</button></div></div></article>;
}
function ListingModal({ listing, onClose, onSave, onLike, onNotify }: { listing: Listing; onClose: () => void; onSave: () => void; onLike: () => void; onNotify: (message: string) => void }) {
  const [comment, setComment] = useState('');
  const [comments, setComments] = useState([{ author: 'Bea C.', initials: 'BC', text: 'Is this still available for pickup this weekend?' }]);
  const submit = (event: FormEvent) => { event.preventDefault(); if (comment.trim()) { setComments((items) => [...items, { author: 'You', initials: 'YC', text: comment.trim() }]); setComment(''); } };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal detail-modal" role="dialog" aria-modal="true" aria-label={listing.title} data-testid="dialog-listing-detail"><div className="modal-head"><span className="eyebrow" style={{ margin: 0 }}>Listing details</span><button className="close-button" onClick={onClose} aria-label="Close details" data-testid="button-close-detail"><X size={17} /></button></div><div className="modal-body"><div className="detail-layout"><div className="detail-visual" style={tileStyles[listing.category]}>{listing.images[0] ? <img src={listing.images[0].url} alt={listing.title} /> : <span className="visual-symbol"><Package size={65} /></span>}</div><div className="detail-copy"><p className="eyebrow">{listing.category} · {listing.condition}</p><h1>{listing.title}</h1><div className="detail-price">{money(listing.price)}</div><div className="detail-location"><MapPin size={14} /> {listing.location}</div><p className="detail-description">{listing.description}</p><div className="seller-box"><span className="avatar">{listing.initials}</span><div><strong>{listing.seller}</strong><span>Active seller · Philippines</span></div><button className="button-ghost" onClick={() => onNotify('Seller profile preview coming right up.')} data-testid="button-view-seller">View</button></div><div className="detail-actions"><button className="button-primary" onClick={() => onNotify('Message draft opened for the seller.')} data-testid="button-contact-seller"><MessageCircle size={15} /> Contact seller</button><button className="button-secondary" onClick={() => onNotify('Interest sent. The seller will see your note.')} data-testid="button-show-interest"><Heart size={15} /> I am interested</button></div><div className="post-actions"><button className={`post-action ${listing.liked ? 'liked' : ''}`} onClick={onLike} data-testid="button-like-detail"><Heart size={15} fill={listing.liked ? 'currentColor' : 'none'} /> {listing.likes}</button><button className="post-action" onClick={() => navigator.clipboard?.writeText(window.location.href)} data-testid="button-share-detail"><Share2 size={15} /> Share</button><button className={`post-action ${listing.saved ? 'saved' : ''}`} onClick={onSave} data-testid="button-save-detail"><Bookmark size={15} fill={listing.saved ? 'currentColor' : 'none'} /> Save</button></div></div></div><div className="comments"><h3>Questions from the community</h3>{comments.map((item, index) => <div className="comment-row" key={`${item.author}-${index}`}><span className="avatar">{item.initials}</span><div><strong>{item.author}</strong><p>{item.text}</p></div></div>)}<form className="comment-form" onSubmit={submit}><input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Ask about this listing" data-testid="input-detail-comment" /><button type="submit" aria-label="Send question" data-testid="button-detail-comment"><Send size={14} /></button></form></div></div></section></div>;
}

type ModerationStatus = 'pending' | 'approved' | 'rejected';

function ModerationModal({
  posts,
  loading,
  error,
  submitting,
  onClose,
  onRetry,
  onModerate,
}: {
  posts: MarketplacePost[];
  loading: boolean;
  error: boolean;
  submitting: boolean;
  onClose: () => void;
  onRetry: () => void;
  onModerate: (id: string, status: ModerationStatus, note: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState('');

  const decide = async (id: string, status: ModerationStatus) => {
    setActionError('');
    try {
      await onModerate(id, status, notes[id] ?? '');
    } catch (moderationError) {
      setActionError(moderationError instanceof Error ? moderationError.message : 'The review could not be saved.');
    }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal admin-modal" role="dialog" aria-modal="true" aria-label="Owner review queue" data-testid="dialog-moderation">
      <div className="modal-head">
        <div><p className="eyebrow" style={{ margin: 0 }}>Owner tools</p><h2>Review queue</h2></div>
        <button className="close-button" onClick={onClose} aria-label="Close review queue" data-testid="button-close-moderation"><X size={17} /></button>
      </div>
      <div className="modal-body">
        <p className="page-subtitle moderation-intro">Keep the marketplace useful and welcoming. Public posts that are not rejected remain visible to buyers across the Philippines.</p>
        {error && <div className="api-notice" role="alert" data-testid="status-moderation-error"><CircleAlert size={16} /><span><strong>Review queue unavailable</strong> Owner access is limited to the account configured by the site owner.</span><button className="button-ghost" onClick={onRetry} data-testid="button-retry-moderation">Try again</button></div>}
        {loading ? <div className="moderation-skeletons"><div className="skeleton" /><div className="skeleton" /></div> : !error && posts.length === 0 ? <div className="empty-state moderation-empty"><div className="empty-icon"><ShieldCheck size={20} /></div><strong>Nothing needs a decision</strong><p>Approved and pending posts will appear here when the owner queue has work.</p></div> : <div className="moderation-list">{posts.map((post) => {
          const status = post.status ?? 'pending';
          return <article className="moderation-row" key={post.id} data-testid={`row-moderation-${post.id}`}>
            <div className="moderation-row-copy"><div className="moderation-row-title"><strong>{post.title}</strong><span className={`status-pill status-${status}`}>{status}</span></div><p>{post.description}</p><small>{money(Number(post.price))} · {post.location} · {post.seller}</small></div>
            <div className="moderation-actions">{status === 'pending' && <><textarea value={notes[post.id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [post.id]: event.target.value }))} placeholder="Optional note for the owner" aria-label={`Note for ${post.title}`} data-testid={`input-moderation-note-${post.id}`} /><div><button className="button-secondary" onClick={() => { void decide(post.id, 'rejected'); }} disabled={submitting} data-testid={`button-reject-${post.id}`}>Return</button><button className="button-primary" onClick={() => { void decide(post.id, 'approved'); }} disabled={submitting} data-testid={`button-approve-${post.id}`}>Approve</button></div></>}</div>
          </article>;
        })}</div>}
        {actionError && <div className="form-error" role="alert" data-testid="status-moderation-action-error"><CircleAlert size={14} /> {actionError}</div>}
      </div>
    </section>
  </div>;
}

function CreateModal({ onClose, onPublish, requestUpload }: { onClose: () => void; onPublish: (listing: MarketplacePostInput) => Promise<void>; requestUpload: (variables: { data: { name: string; size: number; contentType: string } }) => Promise<{ uploadURL: string; objectPath: string }> }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const type: PostType = 'For sale';
  const [category, setCategory] = useState<Exclude<Category, 'All'>>('Tech');
  const [city, setCity] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [barangay, setBarangay] = useState('');
  const [condition, setCondition] = useState('Good');
  const [images, setImages] = useState<ImagePreview[]>([]);
  const [video, setVideo] = useState<VideoPreview>();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleImages = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).slice(0, 4 - images.length);
    setImages((items) => [...items, ...files.map((file) => ({
      id: `${file.name}-${file.lastModified}`,
      url: URL.createObjectURL(file),
      name: file.name,
      file,
    }))]);
    event.target.value = '';
  };

  const removeImage = (id: string) => setImages((items) => {
    const image = items.find((entry) => entry.id === id);
    if (image?.file) URL.revokeObjectURL(image.url);
    return items.filter((entry) => entry.id !== id);
  });

  const handleVideo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setError('Please choose a video file.');
      return;
    }
    if (video?.file) URL.revokeObjectURL(video.url);
    setVideo({
      id: `${file.name}-${file.lastModified}`,
      url: URL.createObjectURL(file),
      name: file.name,
      file,
    });
    setError('');
    event.target.value = '';
  };

  const upload = async (media: ImagePreview | VideoPreview): Promise<StoredMedia> => {
    if (!media.file) return { id: media.id, url: media.url, name: media.name, objectPath: media.objectPath };
    const response = await requestUpload({
      data: { name: media.file.name, size: media.file.size, contentType: media.file.type },
    });
    const result = await fetch(response.uploadURL, {
      method: 'PUT',
      headers: { 'Content-Type': media.file.type },
      body: media.file,
    });
    if (!result.ok) throw new Error('Unable to store media file.');
    return {
      id: media.id,
      name: media.file.name,
      url: apiMediaUrl(response.objectPath),
      objectPath: response.objectPath,
    };
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const selectedLocation = [city.trim() || municipality.trim(), barangay.trim()].filter(Boolean).join(' · ');
    if (!title.trim() || !description.trim() || !price || Number(price) < 0) {
      setError('Add a title, a short description, and a valid price to publish.');
      return;
    }
    if ((!city.trim() && !municipality.trim()) || !barangay.trim()) {
      setError('Choose a city or bayan, then select a barangay from the Philippine location search.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const storedImages = await Promise.all(images.map(upload));
      const storedVideo = video ? await upload(video) : null;
      await onPublish({
        title: title.trim(),
        description: description.trim(),
        price: Number(price),
        type,
        category,
        location: selectedLocation,
        condition,
        seller: 'You',
        initials: nameInitials('You'),
        images: storedImages,
        video: storedVideo,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to publish this sale.');
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-label="Create a marketplace post" data-testid="dialog-create-post">
      <div className="modal-head">
        <div><p className="eyebrow" style={{ margin: 0 }}>Put it out there</p><h2>Create a marketplace post</h2></div>
        <button className="close-button" onClick={onClose} aria-label="Close create post" data-testid="button-close-create"><X size={17} /></button>
      </div>
      <form className="modal-body" onSubmit={submit}>
        <div className="form-grid">
          <div className="form-field full"><label htmlFor="post-title">What are you listing?</label><input id="post-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Example: Small oak desk, barely used" data-testid="input-post-title" /></div>
          <div className="form-field full"><label htmlFor="post-description">Description</label><textarea id="post-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add the useful details: condition, size, meetup notes..." data-testid="input-post-description" /></div>
          <div className="form-field full"><label>Post type</label><div className="type-toggle"><button type="button" className="active" aria-pressed="true" data-testid="button-post-type-for-sale">For sale</button></div></div>
          <div className="form-field"><label htmlFor="post-price">Price in pesos</label><input id="post-price" type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="0" data-testid="input-post-price" /></div>
          <div className="form-field"><label htmlFor="post-condition">Condition</label><select id="post-condition" value={condition} onChange={(event) => setCondition(event.target.value)} data-testid="select-post-condition"><option>New</option><option>Like new</option><option>Good</option><option>For parts</option></select></div>
          <div className="form-field"><label htmlFor="post-category">Category</label><select id="post-category" value={category} onChange={(event) => setCategory(event.target.value as Exclude<Category, 'All'>)} data-testid="select-post-category">{categories.filter((item): item is Exclude<Category, 'All'> => item !== 'All').map((item) => <option value={item} key={item}>{item}</option>)}</select></div>
          <div className="form-field full location-form-field">
            <div className="location-fields">
              <LocationAutocomplete level="City" value={city} label="City" placeholder="Piliin ang city" onChange={(value) => { setCity(value); if (value) { setMunicipality(''); setBarangay(''); } }} testId="input-post-city" />
              <LocationAutocomplete level="Municipality" value={municipality} label="Bayan / Municipality" placeholder="Piliin ang bayan" onChange={(value) => { setMunicipality(value); if (value) { setCity(''); setBarangay(''); } }} testId="input-post-municipality" />
              <LocationAutocomplete level="Barangay" value={barangay} parent={city || municipality} label="Barangay" placeholder={city || municipality ? 'Piliin ang barangay' : 'Piliin muna ang city o bayan'} onChange={setBarangay} disabled={!city && !municipality} testId="input-post-barangay" />
            </div>
            <p className="location-help">Pumili ng city o bayan, pagkatapos ay barangay.</p>
          </div>
          <div className="form-field full">
            <label>Photos <span>(up to 4)</span></label>
            <div className="upload-zone"><ImagePlus size={22} /><div><strong>Add clear photos</strong><span>JPG, PNG, WEBP · uploaded when you publish</span></div><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={handleImages} data-testid="input-post-images" /></div>
            {images.length > 0 && <div className="preview-row">{images.map((image) => <div className="preview-thumb" key={image.id}><img src={image.url} alt={`Preview ${image.name}`} /><button type="button" onClick={() => removeImage(image.id)} aria-label={`Remove ${image.name}`} data-testid={`button-remove-image-${image.id}`}><X size={11} /></button></div>)}</div>}
          </div>
          <div className="form-field full">
            <label>Video upload <span>(free)</span></label>
            <div className="upload-zone video-upload-zone">
              <Video size={22} />
              <div><strong>{video ? 'Video selected' : 'Add a video'}</strong><span>{video ? video.name : 'MP4, MOV, WEBM · free upload'}</span></div>
              <input type="file" accept="video/*" onChange={handleVideo} data-testid="input-post-video" />
            </div>
            {video && <div className="video-selected-row"><span><Video size={14} /> Free video upload</span><button type="button" className="button-ghost button-danger" onClick={() => setVideo(undefined)} data-testid="button-remove-video">Remove</button></div>}
            <p className="upload-help">Video upload is free. Add a video above and publish it publicly.</p>
          </div>
        </div>
        {error && <div className="form-error"><CircleAlert size={14} /> {error}</div>}
        <div className="modal-footer"><button type="button" className="button-secondary" onClick={onClose} disabled={submitting} data-testid="button-cancel-post">Cancel</button><button type="submit" className="button-primary" disabled={submitting} data-testid="button-publish-post"><Send size={15} /> {submitting ? 'Saving…' : 'Publish post'}</button></div>
      </form>
    </section>
  </div>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><ErrorBoundary><MarketplaceApp /></ErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;
