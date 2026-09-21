import { useId, type ComponentPropsWithoutRef } from 'react'
import { Icon } from '../../atoms/Icon/Icon'
import './CategoryOption.css'

type CategoryOptionProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'type' | 'children' | 'name' | 'value' | 'aria-labelledby' | 'aria-describedby'
> & {
  /** Accessible name and visible text. */
  label: string
  /** Optional supporting text, announced as the radio's description. */
  description?: string | undefined
  /** Shared by every option in the group, so the browser groups them. */
  name: string
  /** Submitted and reported through `onChange` when this option is chosen. */
  value: string
}

/**
 * One choice in a category radiogroup: a native radio inside a label, with a
 * check mark. The caller owns the radiogroup, the shared `name` and the state.
 *
 * @example
 * import { CategoryOption } from '../components/molecules/CategoryOption/CategoryOption'
 *
 * <div role="radiogroup" aria-labelledby="category-heading">
 *   {categories.map((category) => (
 *     <CategoryOption
 *       key={category.id}
 *       name="category"
 *       value={category.id}
 *       label={category.label}
 *       checked={selected === category.id}
 *       onChange={(event) => setSelected(event.currentTarget.value)}
 *     />
 *   ))}
 * </div>
 */
export function CategoryOption({ label, description, className, ...props }: CategoryOptionProps) {
  const id = useId()
  const labelId = `${id}-label`
  const descriptionId = description ? `${id}-description` : undefined
  const classes = ['category-option', className].filter(Boolean).join(' ')
  return (
    <label className={classes}>
      <span className="category-option__text">
        <span id={labelId} className="category-option__label">
          {label}
        </span>
        {description && (
          <span id={descriptionId} className="category-option__description">
            {description}
          </span>
        )}
      </span>
      <span className="category-option__mark">
        <input
          {...props}
          className="category-option__input"
          type="radio"
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
        />
        <Icon name="check" size="sm" />
      </span>
    </label>
  )
}
