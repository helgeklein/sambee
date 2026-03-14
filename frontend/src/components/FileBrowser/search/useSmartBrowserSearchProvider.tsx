import { useCallback, useMemo, useState } from "react";
import type { SearchProvider, SearchResult, SearchSelectionBehavior, SearchStatusInfo } from "./types";

interface SmartBrowserSearchProviderOptions {
  directoryProvider: SearchProvider;
  commandsProvider: SearchProvider;
}

const COMMAND_PREFIX = ">";

type ResultPrefix = "directory" | "command";

function prefixResults(prefix: ResultPrefix, results: SearchResult[]): SearchResult[] {
  return results.map((result) => ({
    ...result,
    id: `${prefix}:${result.id}`,
    value: `${prefix}:${result.value}`,
  }));
}

function decodeValue(value: string): { prefix: ResultPrefix; rawValue: string } | null {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const prefix = value.slice(0, separatorIndex);
  if (prefix !== "directory" && prefix !== "command") {
    return null;
  }

  return {
    prefix,
    rawValue: value.slice(separatorIndex + 1),
  };
}

export function useSmartBrowserSearchProvider({ directoryProvider, commandsProvider }: SmartBrowserSearchProviderOptions): SearchProvider {
  const [isCommandQuery, setIsCommandQuery] = useState(false);

  const getMinQueryLength = useCallback(
    (query: string): number => {
      if (query.startsWith(COMMAND_PREFIX)) {
        return 1;
      }

      return directoryProvider.getMinQueryLength?.(query) ?? directoryProvider.minQueryLength;
    },
    [directoryProvider]
  );

  const getBelowMinimumMessage = useCallback(
    (query: string): string | undefined => {
      if (query.startsWith(COMMAND_PREFIX)) {
        return undefined;
      }

      return directoryProvider.getBelowMinimumMessage?.(query) ?? directoryProvider.belowMinimumMessage;
    },
    [directoryProvider]
  );

  const fetchResults = useCallback(
    async (query: string, signal: AbortSignal): Promise<SearchResult[]> => {
      if (query.startsWith(COMMAND_PREFIX)) {
        setIsCommandQuery(true);
        const commandQuery = query.slice(COMMAND_PREFIX.length).trimStart();
        const commandResults = await commandsProvider.fetchResults(commandQuery, signal);
        return prefixResults("command", commandResults);
      }

      setIsCommandQuery(false);

      if (query.length < directoryProvider.minQueryLength) {
        return [];
      }

      const directoryResults = await directoryProvider.fetchResults(query, signal);
      return prefixResults("directory", directoryResults);
    },
    [commandsProvider, directoryProvider]
  );

  const onSelect = useCallback(
    (value: string): SearchSelectionBehavior | undefined => {
      const decoded = decodeValue(value);
      if (!decoded) {
        return undefined;
      }

      switch (decoded.prefix) {
        case "command":
          return commandsProvider.onSelect(decoded.rawValue);
        case "directory":
          return directoryProvider.onSelect(decoded.rawValue);
      }
    },
    [commandsProvider, directoryProvider]
  );

  const getStatusInfo = useCallback((): SearchStatusInfo | null => {
    if (isCommandQuery) {
      return null;
    }

    return directoryProvider.getStatusInfo();
  }, [directoryProvider, isCommandQuery]);

  const onQueryChange = useCallback((query: string) => {
    setIsCommandQuery(query.startsWith(COMMAND_PREFIX));
  }, []);

  const onActivate = useCallback(() => {
    setIsCommandQuery(false);
    directoryProvider.onActivate?.();
  }, [directoryProvider]);

  const onDeactivate = useCallback(() => {
    directoryProvider.onDeactivate?.();
    setIsCommandQuery(false);
  }, [directoryProvider]);

  const footerHint = useMemo(() => {
    if (isCommandQuery) {
      return commandsProvider.footerHint;
    }

    return (
      <>
        ↑↓ navigate&ensp;↵ open&ensp;<kbd>&gt;</kbd> commands&ensp;<kbd>esc</kbd> close
      </>
    );
  }, [commandsProvider.footerHint, isCommandQuery]);

  const footerInfo = useCallback(
    (resultCount: number): string | undefined => {
      if (isCommandQuery) {
        return commandsProvider.footerInfo?.(resultCount);
      }

      return `${resultCount} result${resultCount === 1 ? "" : "s"}`;
    },
    [commandsProvider, isCommandQuery]
  );

  return {
    id: "smart-browser-search",
    modeLabel: isCommandQuery ? "Commands" : "Navigate",
    placeholder: isCommandQuery ? "Run a command" : "Go to any folder or type > for commands",
    debounceMs: 0,
    minQueryLength: directoryProvider.minQueryLength,
    getMinQueryLength,
    fetchResults,
    onSelect,
    getStatusInfo,
    onActivate,
    onQueryChange,
    onDeactivate,
    footerHint,
    footerInfo,
    shortcutHint: isCommandQuery ? commandsProvider.shortcutHint : "Ctrl+K",
    belowMinimumMessage: directoryProvider.belowMinimumMessage,
    getBelowMinimumMessage,
  };
}
