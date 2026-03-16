import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  AVAILABLE_TOPICS,
  fetchMarketNews,
  formatPublishedTime,
  getSentimentInfo,
  getTopRelevantTickers,
  POPULAR_TICKERS,
  type NewsItem,
  type NewsResponse
} from '../utils/alphavantage-news';

type NewsSearchParams = {
  topics?: string;
  tickers?: string;
};

export const Route = createFileRoute('/news')({
  head: () => ({
    meta: [
      { title: 'Market News' },
    ],
    links: [
      {
        rel: 'icon',
        href: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📰</text></svg>'
      }
    ],
  }),
  validateSearch: (search: Record<string, unknown>): NewsSearchParams => {
    return {
      topics: typeof search.topics === 'string' ? search.topics : undefined,
      tickers: typeof search.tickers === 'string' ? search.tickers : undefined,
    };
  },
  component: NewsPage,
});

function NewsPage() {
  const navigate = useNavigate({ from: '/news' });
  const { topics, tickers } = Route.useSearch();

  const [newsData, setNewsData] = useState<NewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickerInput, setTickerInput] = useState('');

  const selectedTopics = topics?.split(',').filter(Boolean) || [];
  const selectedTickers = tickers?.split(',').filter(Boolean) || [];
  useEffect(() => {
    loadNews();
  }, [topics, tickers]);

  async function loadNews() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchMarketNews({
        data: {
          topics: topics ?? undefined,
          tickers: tickers ?? undefined,
          limit: 50,
        }
      });
      setNewsData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load news');
    } finally {
      setLoading(false);
    }
  }

  function updateFilters(newTopics?: string[], newTickers?: string[]) {
    const topicsParam = newTopics?.length ? newTopics.join(',') : undefined;
    const tickersParam = newTickers?.length ? newTickers.join(',') : undefined;

    navigate({
      search: {
        topics: topicsParam,
        tickers: tickersParam,
      },
    });
  }

  function toggleTopic(topic: string) {
    const newTopics = selectedTopics.includes(topic)
      ? selectedTopics.filter(t => t !== topic)
      : [...selectedTopics, topic];
    updateFilters(newTopics, selectedTickers);
  }

  function toggleTicker(ticker: string) {
    const newTickers = selectedTickers.includes(ticker)
      ? selectedTickers.filter(t => t !== ticker)
      : [...selectedTickers, ticker];
    updateFilters(selectedTopics, newTickers);
  }

  function addCustomTicker() {
    const ticker = tickerInput.trim().toUpperCase();
    if (ticker && !selectedTickers.includes(ticker)) {
      updateFilters(selectedTopics, [...selectedTickers, ticker]);
    }
    setTickerInput('');
  }

  function clearAllFilters() {
    navigate({ search: {} });
  }

  const hasFilters = selectedTopics.length > 0 || selectedTickers.length > 0;

  return (
    <div un-p="2" un-mx="auto">

      <header un-border="~ slate-200 rounded-xl" un-shadow="sm" un-p='2' un-flex='~ col gap-2' >
        <div un-flex='~ items-center gap-2 wrap' >
          <span un-text="sm">Topics: </span>
          {AVAILABLE_TOPICS.map((topic) => (
            <button
              key={topic.value}
              un-p="x-2 y-1"
              un-text="sm"
              un-cursor="pointer"
              un-transition="all"
              un-border="~ rounded-lg"
              un-bg={selectedTopics.includes(topic.value) ? 'blue-600' : 'white hover:blue-50'}
              un-text-color={selectedTopics.includes(topic.value) ? 'white' : 'slate-600'}
              un-border-color={selectedTopics.includes(topic.value) ? 'blue-600' : 'slate-200 hover:blue-300'}
              onClick={() => toggleTopic(topic.value)}
            >
              {topic.label}
            </button>
          ))}
          {hasFilters && (
            <button un-ml='auto'
              un-text="xs blue-600"
              un-cursor="pointer"
              un-hover="underline"
              onClick={clearAllFilters}
            >
              Clear all
            </button>
          )}
        </div>

        <div un-flex='~ items-center gap-2 wrap' >
          <span un-text="sm">Tickers: </span>
          {POPULAR_TICKERS.map((ticker) => (
            <button
              key={ticker.value}
              un-p="x-2 y-1"
              un-text="sm"
              un-cursor="pointer"
              un-transition="all"
              un-border="~ rounded-lg"
              un-bg={selectedTickers.includes(ticker.value) ? 'purple-600' : 'white hover:purple-50'}
              un-text-color={selectedTickers.includes(ticker.value) ? 'white' : 'slate-600'}
              un-border-color={selectedTickers.includes(ticker.value) ? 'purple-600' : 'slate-200 hover:purple-300'}
              onClick={() => toggleTicker(ticker.value)}
            >
              {ticker.label}
            </button>
          ))}
          {selectedTickers
            .filter(t => !POPULAR_TICKERS.some(p => p.value === t))
            .map((ticker) => (
              <button
                key={ticker}
                un-p="x-2 y-1"
                un-text="sm white"
                un-cursor="pointer"
                un-bg="purple-600"
                un-border="~ purple-600 rounded-lg"
                onClick={() => toggleTicker(ticker)}
              >
                {ticker} ✕
              </button>
            ))}
          <div un-flex="~ items-center" un-gap="1">
            <input
              type="text"
              placeholder="TICKER"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && addCustomTicker()}
              un-p="x-2 y-1"
              un-w="20"
              un-text="sm center"
              un-border="~ slate-200"
              un-rounded="lg"
              un-outline="none focus:blue-500"
            />
            <button
              un-p="x-2 y-1"
              un-bg="slate-100 hover:slate-200"
              un-rounded="lg"
              un-cursor="pointer"
              un-text="sm"
              onClick={addCustomTicker}
            >
              +
            </button>
          </div>
        </div>
      </header>

      {loading && (
        <div un-flex="~ col items-center justify-center" un-py="20">
          <div
            un-w="12"
            un-h="12"
            un-border="4 blue-500 t-transparent"
            un-rounded="full"
            un-animate="spin"
          />
          <p un-text="slate-500" un-mt="4">
            Loading market news...
          </p>
        </div>
      )}

      {error && (
        <div
          un-bg="red-50"
          un-border="~ red-200 rounded-xl"
          un-p="6"
          un-text="center"
        >
          <p un-text="red-600 lg" un-font="medium">
            ⚠️ {error}
          </p>
          <button
            un-mt="4"
            un-p="x-4 y-2"
            un-bg="red-600"
            un-text="white"
            un-rounded="lg"
            un-cursor="pointer"
            un-hover="bg-red-700"
            onClick={loadNews}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div un-mt='2' un-grid="~ cols-1 lg:cols-2 xl:cols-3 gap-2">
            {newsData?.feed?.map((item, idx) => (
              <NewsCard key={`${item.url}-${idx}`} item={item} onTopicClick={toggleTopic} onTickerClick={toggleTicker} />
            ))}
          </div>

          {newsData?.feed?.length === 0 && (
            <div un-text="center" un-py="12" un-text-slate="400">
              No news found. Try adjusting your filters.
            </div>
          )}
        </>
      )}

      <div
        un-mt="4"
        un-p="4"
        un-bg="slate-50"
        un-rounded="xl"
        un-text="slate-500 xs"
      >
        <p>
          📊 Powered by Alpha Vantage News Sentiment API •
          Sentiment: -1 (bearish) to +1 (bullish) •
          Cached for 30 minutes
        </p>
      </div>
    </div>
  );
}

function NewsCard({ item, onTopicClick, onTickerClick }: { item: NewsItem; onTopicClick: (topic: string) => void; onTickerClick: (ticker: string) => void }) {
  const sentimentInfo = getSentimentInfo(item.overall_sentiment_score);
  const topTickers = getTopRelevantTickers(item.ticker_sentiment);

  return (
    <div un-p='2'
      un-border="~ slate-200 rounded-xl"
      un-overflow="hidden"
      un-shadow="sm"
      un-hover="shadow-lg border-blue-300"
      un-transition="all"
    >
      <header un-text="hover:blue-600" un-font="semibold" un-cursor="pointer">
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          {item.title}
        </a>
      </header>

      <p un-text="sm slate-600">
        {item.summary}
      </p>

      <div un-flex="~">
        <div un-p="2" un-flex="~ col gap-1">
          <div un-flex="~ justify-between gap-4">
            <span un-text="xs slate-500" un-font="medium">
              {item.source}
            </span>
            <span un-text="xs slate-400">
              {formatPublishedTime(item.time_published)}
            </span>
            <span
              un-rounded="lg"
              un-text={`xs ${sentimentInfo.color}`}
              un-bg={sentimentInfo.bgColor}
            >
              {sentimentInfo.emoji} {sentimentInfo.label} ({item.overall_sentiment_score.toFixed(2)})
            </span>
          </div>

          <div un-flex='~ wrap gap-1'>
            {item.topics.map(({ topic }) => <span
              key={topic}
              un-p="x-2 y-1"
              un-rounded="lg"
              un-text="xs"
              un-bg="slate-100 hover:slate-200"
              un-border="~ slate-200"
              un-cursor="pointer"
              un-transition="all"
              onClick={() => onTopicClick(topic)}
            >
              {topic}
            </span>
            )}
          </div>

          <div un-flex="~ wrap items-center gap-2">
            {topTickers.map((ticker) => {
              const tickerSentiment = getSentimentInfo(parseFloat(ticker.ticker_sentiment_score));
              return (
                <button
                  key={ticker.ticker}
                  un-p="x-2 y-1"
                  un-rounded="lg"
                  un-text="xs"
                  un-bg="slate-100 hover:slate-200"
                  un-border="~ slate-200"
                  un-cursor="pointer"
                  un-transition="all"
                  onClick={() => onTickerClick(ticker.ticker)}
                >
                  <span un-font="semibold">{ticker.ticker}</span>
                  <span un-text={tickerSentiment.color} un-ml="1">
                    {tickerSentiment.emoji}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {item.banner_image && (
          <a un-flex='1' href={item.url} target="_blank" rel="noopener noreferrer">
            <div un-h="40" un-overflow="hidden" un-bg="slate-100" un-cursor="pointer">
              <img
                src={item.banner_image}
                alt={item.title}
                un-w="full"
                un-h="full"
                un-object="cover"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </div>
          </a>
        )}
      </div>
    </div>
  );
}

export const UnoTrick = <div un-text="emerald-600 green-600 red-600 orange-600 slate-500" un-bg="emerald-50 green-50 red-50 orange-50 slate-50" />