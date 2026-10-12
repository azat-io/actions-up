/**
 * Line of a multiselect list: the label of a group, an option of the group
 * above it, or a line that cannot be focused, such as a column header or a
 * blank line.
 */
export type MultiselectEntry<Value> =
  MultiselectOption<Value> | MultiselectSeparator | MultiselectGroup

/**
 * Option the user can select, unless it is disabled.
 */
interface MultiselectOption<Value> {
  /**
   * Whether the option is selected when the prompt opens.
   */
  selected: boolean

  /**
   * Whether the option can be neither focused nor selected.
   */
  disabled: boolean

  /**
   * Text of the line, possibly colored.
   */
  message: string

  /**
   * Kind of the line.
   */
  kind: 'option'

  /**
   * What the prompt returns for the option once it is selected.
   */
  value: Value
}

/**
 * Line that cannot be focused or selected.
 */
interface MultiselectSeparator {
  /**
   * Kind of the line.
   */
  kind: 'separator'

  /**
   * Text of the line, possibly colored.
   */
  message: string
}

/**
 * Label of a group. The options below it, up to the next label, belong to the
 * group.
 */
interface MultiselectGroup {
  /**
   * Text of the line, possibly colored.
   */
  message: string

  /**
   * Kind of the line.
   */
  kind: 'group'
}
