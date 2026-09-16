import { useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchableMultiSelectOption {
  value: string;
  label?: string;
}

interface SearchableMultiSelectProps {
  options: SearchableMultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage?: string;
  allowCustom?: boolean;
  maxItems?: number;
  "aria-label"?: string;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function SearchableMultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyMessage = "No suggestions found.",
  allowCustom = true,
  maxItems = 20,
  "aria-label": ariaLabel,
}: Readonly<SearchableMultiSelectProps>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const uniqueOptions = options.filter((option, index, all) =>
    all.findIndex((item) => normalize(item.value) === normalize(option.value)) === index,
  );
  const selectedKeys = new Set(selected.map(normalize));
  const customValue = query.trim();
  const hasExactMatch = uniqueOptions.some((option) => normalize(option.value) === normalize(customValue));
  const canAdd = Boolean(customValue) && !hasExactMatch && !selectedKeys.has(normalize(customValue)) && selected.length < maxItems;

  const toggleValue = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const existingIndex = selected.findIndex((item) => normalize(item) === normalize(trimmed));
    if (existingIndex >= 0) {
      onChange(selected.filter((_, index) => index !== existingIndex));
      return;
    }
    if (selected.length >= maxItems) return;
    onChange([...selected, trimmed]);
  };

  const addCustomValue = () => {
    if (!canAdd) return;
    toggleValue(customValue);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="h-10 w-full justify-between font-normal"
        >
          <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
            {selected.length > 0 ? `${selected.length} selected` : placeholder}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
        <Command shouldFilter>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          <CommandList>
            <CommandEmpty>{allowCustom && canAdd ? "Add the custom value below." : emptyMessage}</CommandEmpty>
            <CommandGroup heading="Suggestions">
              {uniqueOptions.map((option) => {
                const isSelected = selectedKeys.has(normalize(option.value));
                const label = option.label ?? option.value;
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => toggleValue(option.value)}
                    disabled={!isSelected && selected.length >= maxItems}
                  >
                    <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100 text-secondary" : "opacity-0")} />
                    <span className="truncate">{label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {allowCustom && canAdd && (
              <CommandGroup heading="Custom">
                <CommandItem value={`add-${customValue}`} onSelect={addCustomValue}>
                  <Plus className="mr-2 h-4 w-4 text-secondary" />
                  Add “{customValue}”
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
