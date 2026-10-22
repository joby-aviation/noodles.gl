/**
 * Which attribute name feeds which render channel.
 *
 * `P`, `Cd`, `pscale` and `Alpha` are Houdini's vocabulary, not this library's. They are a
 * good default — short, familiar to anyone who has written a VEX wrangle, and unambiguous
 * about what they mean — but a consumer with its own naming has to be able to say so, or the
 * planner is only usable by a renderer that agreed to Houdini's spelling.
 *
 * The whole point of gathering them here is that *nothing downstream defaults*. `analyze`
 * resolves every channel to a concrete name up front, so `Analysis.render` and
 * `PhysicalPlan.render` carry resolved names and the emitters, the runtime and the deck.gl
 * adapters read them without a fallback. A `?? 'P'` scattered across six files is the same
 * decision made six times, and the sixth one is where the bug lives.
 */

export interface AttributeConventions {
  /** Written by a `project` node; bound to the position channel. */
  position: string;
  /** Written by a `colorscale` node; bound to the color channel. */
  color: string;
  /** Per-row radius. */
  size: string;
  /** Per-row alpha. */
  opacity: string;
  /**
   * Where a filter's discard mask is written when the filter stays on the GPU rather than
   * removing rows in SQL. Internal by construction: it is never uploaded or displayed.
   */
  mask: string;
  /**
   * Names beginning with this are temporaries. They are excluded from the attribute report,
   * and a temporary nothing outside a kernel reads stays in an SSA register instead of being
   * given a buffer and a binding slot.
   */
  internalPrefix: string;
}

/** The default vocabulary. */
export const HOUDINI_CONVENTIONS: AttributeConventions = Object.freeze({
  position: 'P',
  color: 'Cd',
  size: 'pscale',
  opacity: 'Alpha',
  mask: '__mask',
  internalPrefix: '__',
});

const CHANNELS = ['position', 'color', 'size', 'opacity'] as const;

/**
 * Fill in the defaults and reject a set that cannot work.
 *
 * The validation is not ceremony. Naming a render channel with the internal prefix is the
 * failure that costs the most to debug: the attribute is treated as a temporary, so it is
 * never given a buffer, and the symptom is a render pass binding an attribute that does not
 * exist — reported by WebGPU at submit time, far from the graph that named it.
 */
export function attributeConventions(
  partial?: Partial<AttributeConventions>,
): AttributeConventions {
  const c: AttributeConventions = { ...HOUDINI_CONVENTIONS, ...partial };

  if (!c.internalPrefix) {
    throw new Error('attributeConventions: internalPrefix must be a non-empty string');
  }
  for (const channel of CHANNELS) {
    const name = c[channel];
    if (!name) throw new Error(`attributeConventions: ${channel} must be a non-empty name`);
    if (name.startsWith(c.internalPrefix)) {
      throw new Error(
        `attributeConventions: ${channel} is '${name}', which starts with the internal ` +
        `prefix '${c.internalPrefix}'. Internal attributes get no buffer, so a render ` +
        'channel cannot use one.',
      );
    }
  }
  if (!c.mask.startsWith(c.internalPrefix)) {
    throw new Error(
      `attributeConventions: mask is '${c.mask}' but must start with the internal prefix ` +
      `'${c.internalPrefix}' so it is never uploaded or reported as a visible attribute.`,
    );
  }
  const seen = new Map<string, string>();
  for (const channel of CHANNELS) {
    const clash = seen.get(c[channel]);
    if (clash) {
      throw new Error(
        `attributeConventions: ${channel} and ${clash} are both '${c[channel]}'. ` +
        'Two channels reading one attribute is legal in a graph but not as a default, ' +
        'because desugaring would have two nodes writing the same name.',
      );
    }
    seen.set(c[channel], channel);
  }
  return c;
}

/** True for a temporary: excluded from reports, register-only inside a kernel. */
export function isInternal(name: string, c: AttributeConventions): boolean {
  return name.startsWith(c.internalPrefix);
}
