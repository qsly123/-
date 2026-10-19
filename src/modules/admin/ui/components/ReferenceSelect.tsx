"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "antd";
import type { AdminEntity } from "@/modules/admin/services/admin-entities";

export interface ReferenceOption {
  label: string;
  value: string;
  rawLabel: string;
  searchText: string;
  initials: string;
}

interface ReferenceListResult {
  rows: Record<string, unknown>[];
  total: number;
}

interface ReferenceSelectProps {
  value?: string;
  onChange?: (value: string | undefined) => void;
  onSelectOption?: (value: string | undefined, option?: ReferenceOption) => void;
  entity: AdminEntity;
  labelKey: string;
  disabled?: boolean;
  placeholder?: string;
  allowClear?: boolean;
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

const PINYIN_INITIAL_BOUNDARIES = [
  "阿",
  "芭",
  "擦",
  "搭",
  "蛾",
  "发",
  "噶",
  "哈",
  "机",
  "喀",
  "垃",
  "妈",
  "拿",
  "哦",
  "啪",
  "期",
  "然",
  "撒",
  "塌",
  "挖",
  "昔",
  "压",
  "匝",
];
const PINYIN_INITIAL_LETTERS = "abcdefghjklmnopqrstwxyz";
const ITEM_PRELOAD_PAGE_SIZE = 200;
const ITEM_DROPDOWN_MAX_OPTIONS = 200;
const AI_ITEM_ID_PREFIXES = [
  "item_ai_alchemy_",
  "item_ai_smithing_",
  "item_secret_realm_",
];

function normalizeSearchKeyword(value: string) {
  return value.trim().toLowerCase();
}

function getCharInitial(char: string) {
  if (!char) {
    return "";
  }
  if (/^[a-z0-9]$/i.test(char)) {
    return char.toLowerCase();
  }
  for (let index = PINYIN_INITIAL_BOUNDARIES.length - 1; index >= 0; index -= 1) {
    if (char.localeCompare(PINYIN_INITIAL_BOUNDARIES[index], "zh-CN-u-co-pinyin") >= 0) {
      return PINYIN_INITIAL_LETTERS[index] || "";
    }
  }
  return "";
}

function buildInitials(text: string) {
  return Array.from(text).map((char) => getCharInitial(char)).join("");
}

function createReferenceOption(row: Record<string, unknown>, labelKey: string): ReferenceOption {
  const id = normalizeText(row.id);
  const rawLabel = normalizeText(row[labelKey] ?? row.name ?? row.title ?? row.id);
  const sourceType = normalizeText(row.sourceType).trim();
  const isAiItem = sourceType === "secret_realm"
    || sourceType === "ai_smithing"
    || sourceType === "ai_alchemy"
    || AI_ITEM_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
  const displayLabel = isAiItem ? `${rawLabel} (${id}) [AI]` : `${rawLabel} (${id})`;
  return {
    value: id,
    label: displayLabel,
    rawLabel,
    searchText: normalizeSearchKeyword(`${rawLabel} ${id} ${displayLabel}`),
    initials: buildInitials(rawLabel),
  };
}

async function fetchReferenceList(params: {
  entity: AdminEntity;
  keyword?: string;
  page: number;
  pageSize: number;
}): Promise<ReferenceListResult> {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.keyword?.trim()) {
    searchParams.set("keyword", params.keyword.trim());
  }

  const response = await fetch(`/api/admin/${params.entity}?${searchParams.toString()}`);
  const json = await response.json();
  return {
    rows: Array.isArray(json?.data?.list) ? json.data.list as Record<string, unknown>[] : [],
    total: Number(json?.data?.pagination?.total || 0),
  };
}

function dedupeReferenceOptions(options: ReferenceOption[]) {
  const seen = new Set<string>();
  const merged: ReferenceOption[] = [];
  for (const option of options) {
    if (!option.value || seen.has(option.value)) {
      continue;
    }
    seen.add(option.value);
    merged.push(option);
  }
  return merged;
}

export default function ReferenceSelect({
  value,
  onChange,
  onSelectOption,
  entity,
  labelKey,
  disabled,
  placeholder,
  allowClear = true,
}: ReferenceSelectProps) {
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<ReferenceOption[]>([]);
  const [keyword, setKeyword] = useState("");
  const [allLoaded, setAllLoaded] = useState(false);
  const cacheRef = useRef(new Map<string, ReferenceOption[]>());
  const requestSeqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isItemsEntity = entity === "items";

  const fetchOptions = useCallback(async (keyword: string) => {
    const cacheKey = `${entity}::${labelKey}::${keyword}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setOptions(cached);
      return;
    }

    const seq = ++requestSeqRef.current;
    setLoading(true);
    try {
      let next: ReferenceOption[] = [];
      if (isItemsEntity) {
        const [formalList, aiList] = await Promise.all([
          fetchReferenceList({
            entity: "items",
            keyword,
            page: 1,
            pageSize: 100,
          }),
          fetchReferenceList({
            entity: "aiItems",
            keyword,
            page: 1,
            pageSize: 100,
          }),
        ]);
        if (requestSeqRef.current !== seq) {
          return;
        }
        next = dedupeReferenceOptions([
          ...formalList.rows.map((row) => createReferenceOption(row, labelKey)),
          ...aiList.rows.map((row) => createReferenceOption(row, labelKey)),
        ]);
      } else {
        const list = await fetchReferenceList({
          entity,
          keyword,
          page: 1,
          pageSize: 20,
        });
        if (requestSeqRef.current !== seq) {
          return;
        }
        next = list.rows.map((row) => createReferenceOption(row, labelKey));
      }

      cacheRef.current.set(cacheKey, next);
      setOptions(next);
    } finally {
      if (requestSeqRef.current === seq) {
        setLoading(false);
      }
    }
  }, [entity, isItemsEntity, labelKey]);

  const fetchAllItemOptions = useCallback(async () => {
    if (!isItemsEntity) {
      return;
    }

    const cacheKey = `${entity}::${labelKey}::__all__`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setOptions(cached);
      setAllLoaded(true);
      return;
    }

    const seq = ++requestSeqRef.current;
    setLoading(true);
    try {
      const collectEntityOptions = async (targetEntity: AdminEntity) => {
        let page = 1;
        let total = Number.POSITIVE_INFINITY;
        const collected: ReferenceOption[] = [];

        while (collected.length < total) {
          const list = await fetchReferenceList({
            entity: targetEntity,
            page,
            pageSize: ITEM_PRELOAD_PAGE_SIZE,
          });
          if (requestSeqRef.current !== seq) {
            return null;
          }

          const rows = list.rows.map((row) => createReferenceOption(row, labelKey));
          collected.push(...rows);
          total = list.total || collected.length;
          if (rows.length < ITEM_PRELOAD_PAGE_SIZE) {
            break;
          }
          page += 1;
        }

        return collected;
      };

      const [formalOptions, aiOptions] = await Promise.all([
        collectEntityOptions("items"),
        collectEntityOptions("aiItems"),
      ]);
      if (!formalOptions || !aiOptions || requestSeqRef.current !== seq) {
        return;
      }

      const merged = dedupeReferenceOptions([...formalOptions, ...aiOptions]);
      cacheRef.current.set(cacheKey, merged);
      setOptions(merged);
      setAllLoaded(true);
    } finally {
      if (requestSeqRef.current === seq) {
        setLoading(false);
      }
    }
  }, [entity, isItemsEntity, labelKey]);

  useEffect(() => {
    if (isItemsEntity) {
      return;
    }
    void fetchOptions("");
  }, [fetchOptions, isItemsEntity]);

  useEffect(() => {
    if (!value) {
      return;
    }

    const exists = options.some((opt) => opt.value === value);
    if (exists) {
      return;
    }

    if (isItemsEntity && allLoaded) {
      return;
    }

    void fetchOptions(value);
  }, [allLoaded, value, options, fetchOptions, isItemsEntity]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const selectValue = useMemo(() => {
    if (!value) {
      return undefined;
    }
    return value;
  }, [value]);

  const displayedOptions = useMemo(() => {
    if (!isItemsEntity) {
      return options;
    }

    const normalizedKeyword = normalizeSearchKeyword(keyword);
    if (!normalizedKeyword) {
      return options.slice(0, ITEM_DROPDOWN_MAX_OPTIONS);
    }

    return options
      .filter((option) => (
        option.searchText.includes(normalizedKeyword)
        || option.initials.includes(normalizedKeyword)
      ))
      .slice(0, ITEM_DROPDOWN_MAX_OPTIONS);
  }, [isItemsEntity, keyword, options]);

  return (
    <Select
      showSearch
      filterOption={false}
      disabled={disabled}
      allowClear={allowClear}
      placeholder={placeholder || "请选择"}
      loading={loading}
      value={selectValue}
      options={displayedOptions}
      onSearch={(keyword) => {
        setKeyword(keyword);
        if (isItemsEntity) {
          if (!allLoaded) {
            void fetchAllItemOptions();
          }
          return;
        }
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => {
          void fetchOptions(keyword);
        }, 200);
      }}
      onFocus={() => {
        if (isItemsEntity) {
          if (!allLoaded) {
            void fetchAllItemOptions();
          }
          return;
        }
        if (options.length === 0) {
          void fetchOptions("");
        }
      }}
      onChange={(next) => {
        const nextValue = next as string | undefined;
        const selected = options.find((opt) => opt.value === nextValue);
        onChange?.(nextValue);
        onSelectOption?.(nextValue, selected);
      }}
    />
  );
}
