import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from '@/components/ui/command';

export function SearchableFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; description?: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          className="w-full min-w-0 justify-between bg-white font-normal"
        >
          <span className="truncate">
            {selected
              ? `${selected.label}${selected.description ? ` · ${selected.description}` : ''}`
              : value || `全部${label}`}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[max(20rem,var(--radix-popover-trigger-width))] max-w-[90vw] p-0"
      >
        <Command>
          <CommandInput
            aria-label={`搜索${label}`}
            placeholder={`输入${label}名称或 ID 筛选`}
          />
          <CommandList>
            <CommandEmpty>没有匹配项</CommandEmpty>
            <CommandItem
              value={`全部${label}`}
              onSelect={() => {
                onChange('');
                setOpen(false);
              }}
            >
              全部{label}
            </CommandItem>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={option.value}
                keywords={[option.label, option.description || '']}
                onSelect={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="break-words">{option.label}</div>
                  {option.description && (
                    <div className="text-xs text-slate-500">
                      {option.description}
                    </div>
                  )}
                </div>
                {value === option.value && (
                  <Check className="size-4 shrink-0 text-blue-600" />
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
