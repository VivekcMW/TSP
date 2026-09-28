import { useId, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface SearchableSelectProps {
  /** Visible label; the trigger is named "<label> <current value>". */
  label: React.ReactNode;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  searchPlaceholder: string;
  emptyMessage: string;
  className?: string;
  labelClassName?: string;
}

// Plain matching, not cmdk's default fuzzy scoring (which let "singa" match "Bosnia and Herzegovina"):
// names starting with the text rank first, then a word starting with it, then anywhere in the name.
export function matchScore(option: string, search: string) {
  const name = option.toLocaleLowerCase();
  const text = search.trim().toLocaleLowerCase();
  if (!text) return 1;
  if (name.startsWith(text)) return 1;
  if (name.split(/[\s-]+/).some(word => word.startsWith(text))) return 0.75;
  return name.includes(text) ? 0.5 : 0;
}

/** Single-choice dropdown with a search box, built on the same Popover + Command parts as SearchableMultiSelect. */
export function SearchableSelect({ label, value, options, onChange, searchPlaceholder, emptyMessage, className, labelClassName }: Readonly<SearchableSelectProps>) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;

  const choose = (option: string) => {
    onChange(option);
    setOpen(false);
  };

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <span id={labelId} className={labelClassName}>{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-haspopup="listbox"
            aria-labelledby={`${labelId} ${valueId}`} className="min-h-11 w-full justify-between text-base font-normal">
            <span id={valueId} className="truncate">{value}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
          <Command filter={matchScore}>
            <CommandInput placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
            <CommandList className="max-h-72">
              <CommandEmpty>{emptyMessage}</CommandEmpty>
              <CommandGroup>
                {options.map(option => (
                  <CommandItem key={option} value={option} onSelect={() => choose(option)} className="min-h-10">
                    <Check className={cn("mr-2 h-4 w-4 text-primary", option === value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
