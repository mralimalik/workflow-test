import { Plus, X } from 'lucide-react'
import type { JsonSchemaPropertyType, ToolParameter } from '@/entities/tool/model/types'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

const PARAM_TYPES: JsonSchemaPropertyType[] = ['string', 'number', 'boolean', 'array', 'object']

export function ToolParametersEditor({
  parameters,
  onChange,
}: {
  parameters: ToolParameter[]
  onChange: (parameters: ToolParameter[]) => void
}) {
  const addParam = () => {
    onChange([
      ...parameters,
      { name: `param${parameters.length + 1}`, type: 'string', description: '', required: true },
    ])
  }

  const updateParam = (index: number, patch: Partial<ToolParameter>) => {
    onChange(parameters.map((param, i) => (i === index ? { ...param, ...patch } : param)))
  }

  const removeParam = (index: number) => {
    onChange(parameters.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      {parameters.map((param, index) => (
        <div key={index} className="space-y-2 rounded-md border border-border p-2.5">
          <div className="flex items-center gap-2">
            <Input
              value={param.name}
              onChange={(e) => updateParam(index, { name: e.target.value })}
              placeholder="param_name"
              className="h-7 flex-1 font-mono text-xs"
            />
            <Select
              value={param.type}
              onValueChange={(type) => updateParam(index, { type: type as JsonSchemaPropertyType })}
            >
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PARAM_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={param.required}
                onChange={(e) => updateParam(index, { required: e.target.checked })}
              />
              required
            </label>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => removeParam(index)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <Input
            value={param.description}
            onChange={(e) => updateParam(index, { description: e.target.value })}
            placeholder="Description shown to the model"
            className="h-7 text-xs"
          />
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addParam}>
        <Plus />
        Parameter
      </Button>
    </div>
  )
}
