const SIZES_SCHEMA_VERSION: number = 1;
const COLUMNS = 10;
const CELL_GAP = 10

function isFrameNode(node: SceneNode): node is FrameNode {
  return node.type === 'FRAME';
}

function isComponentNode(node: SceneNode): node is ComponentNode {
  return node.type === 'COMPONENT';
}

function findFrame(name: string, parent: ChildrenMixin, setSettings?: (frame: FrameNode) => void): FrameNode | null {
  const frame = parent.findOne(node => isFrameNode(node) && node.name === name) as FrameNode | null;
  if (frame) {
    setSettings?.(frame);
    parent.appendChild(frame);
    return frame;
  }

  return null;
}

function findComponentById(id: string, parent: ChildrenMixin): ComponentNode | null {
  const component = parent.findOne(node => isComponentNode(node) && node.id === id) as ComponentNode | null;
  if (component) {
    return component;
  }

  return null;
}

function createFrame(name: string, parent: ChildrenMixin, setSettings?: (frame: FrameNode) => void): FrameNode {
  const frame = figma.createFrame();
  frame.name = name;
  setSettings?.(frame);
  parent.appendChild(frame);
  return frame;
}

function findOrCreateFrame(name: string, parent: ChildrenMixin, onCreated?: (frame: FrameNode) => void): FrameNode {
  const existingFrame = findFrame(name, parent);
  if (existingFrame) {
    return existingFrame;
  }
  return createFrame(name, parent, onCreated);
}

type BoundingBox = Rect & {
  x2: number;
  y2: number;
}

function getBounds(node: LayoutMixin, relativeTo?: BoundingBox): BoundingBox {
  const bb = node.absoluteRenderBounds;
  if (!bb) {
    throw new Error('Node does not have an absolute bounding box');
  }
  const box = {
    x: bb.x,
    y: bb.y,
    width: bb.width,
    height: bb.height,
    x2: bb.x + bb.width,
    y2: bb.y + bb.height,
  };

  if (relativeTo) {
    return {
      x: box.x - relativeTo.x,
      y: box.y - relativeTo.y,
      width: box.width,
      height: box.height,
      x2: box.x2 - relativeTo.x,
      y2: box.y2 - relativeTo.y,
    }
  }

  return box;
}

function generateIconSize(original: FrameNode, icon: MissingIconSize, parent: FrameNode) {
  switch (icon.type) {
    case 'fixed':
      return generateFixedIcon(original, icon, parent);
    case 'cropped':
      return generateCroppedIcon(original, icon, parent);
    default:
      throw new Error(`Unknown icon type: ${icon.type}`);
  }
}

function generateFixedIconFrame(original: FrameNode, icon: MissingIconSize) {
  const inner = original.clone();
  inner.name = `${icon.name}/inner`;
  if (icon.size !== original.width) {
    inner.rescale(icon.size / original.width);
  }

  const outer = figma.createFrame();
  outer.name = icon.name;
  outer.layoutPositioning = 'AUTO';
  outer.layoutMode = 'VERTICAL';
  outer.layoutSizingHorizontal = 'HUG';
  outer.layoutSizingVertical = 'HUG';
  outer.itemSpacing = 0;
  outer.counterAxisSpacing = 0;
  outer.fills = [];
  outer.appendChild(inner);

  return outer;
}

function generateFixedIcon(original: FrameNode, icon: MissingIconSize, parent: FrameNode) {
  const outer = generateFixedIconFrame(original, icon);
  const component = figma.createComponentFromNode(outer);
  parent.appendChild(component);
  return component;
}

function generateCroppedIconFrame(original: FrameNode, icon: MissingIconSize) {
  const outer = generateFixedIconFrame(original, icon);

  const inner = outer.children[0] as FrameNode;
  inner.clipsContent = false;
  inner.name = `${icon.name}/inner`;
  resizeToFit(inner);

  return outer;
}

function generateCroppedIcon(original: FrameNode, icon: MissingIconSize, parent: FrameNode) {
  const outer = generateCroppedIconFrame(original, icon);
  const component = figma.createComponentFromNode(outer);
  parent.appendChild(component);
  return component;
}

function updateFixedIcon(original: FrameNode, icon: GeneratedIconSize) {
  // delete existing children
  icon.component.children.forEach(child => child.remove());

  // generated and insert new
  const outer = generateFixedIconFrame(original, icon);
  outer.children.forEach(child => icon.component.appendChild(child));
  outer.remove();
}

function updateCroppedIcon(original: FrameNode, icon: GeneratedIconSize) {
  // delete existing children
  icon.component.children.forEach(child => child.remove());

  // generated and insert new
  const outer = generateCroppedIconFrame(original, icon);
  outer.children.forEach(child => icon.component.appendChild(child));
  outer.remove();
}


function updateIcon(original: FrameNode, icon: GeneratedIconSize) {
  switch (icon.type) {
    case 'fixed':
      updateFixedIcon(original, icon);
      break;
    case 'cropped':
      updateCroppedIcon(original, icon);
      break;
    default:
      throw new Error(`Unknown icon type: ${icon.type}`);
  }


  icon.component.name = icon.name;
  icon.component.exportSettings = icon.export ? [
    {
      format: 'SVG',
    }
  ] : [];
  icon.updated = true;
}

function findOrCreateGeneratedSizeTypeFrame(icon: MissingIconSize, parent: FrameNode) {
  return findOrCreateFrame(`${icon.type}/${icon.size}px`, parent, frame => {
    layoutIcons(frame, icon.size, COLUMNS);
    frame.fills = [];
    frame.expanded = false;
  });
}

function resizeToFit(
  node: BaseNode & ChildrenMixin & DimensionAndPositionMixin & LayoutMixin & {
    resizeWithoutConstraints: (w: number, h: number) => void;
    resize: (w: number, h: number) => void
  }
) {
  if (node.children.length < 1)
    return

  const parent = getBounds(node);
  const boundingBoxes = node.children.map(child => getBounds(child as LayoutMixin, parent));
  const minX = Math.floor(Math.min(...boundingBoxes.map(child => child.x)));
  const minY = Math.floor(Math.min(...boundingBoxes.map(child => child.y)));
  const maxX = Math.ceil(Math.max(...boundingBoxes.map(child => child.x2)));
  const maxY = Math.ceil(Math.max(...boundingBoxes.map(child => child.y2)));

  const w = maxX - minX
  const h = maxY - minY
  const moveX = minX
  const moveY = minY

  node.resizeWithoutConstraints(w, h)

  node.x += moveX
  node.y += moveY

  for (const child of node.children) {
    child.x -= moveX
    child.y -= moveY
  }
}

function layoutIcons(frame: FrameNode, size: number, columns: number = 1) {
  const rows = Math.max(1, Math.ceil(frame.children.length / columns));
  frame.layoutPositioning = 'AUTO';
  frame.layoutMode = 'HORIZONTAL';
  frame.layoutWrap = 'WRAP';
  frame.itemSpacing = CELL_GAP;
  frame.counterAxisSpacing = CELL_GAP;
  frame.resize((columns * size) + ((columns - 1) * CELL_GAP), (rows * size) + ((rows - 1) * CELL_GAP));
}

function readPluginData<T>(node: PluginDataMixin, key: string, version: number, getDefault: () => T, migrate?: (data: unknown, from: number) => T): T {
  const data = node.getPluginData(key);
  if (!data) {
    return getDefault();
  }

  try {
    const withMeta = JSON.parse(data) as PluginDataMeta<T>;
    if (!withMeta || !withMeta.data || !withMeta.version || withMeta.version !== 1) {
      if (migrate) {
        return migrate(withMeta.data, withMeta.version);
      }
      return getDefault();
    }
    return withMeta.data;
  } catch (e) {
    console.error(e);
    figma.notify(`Error parsing ${key}: ${e}`);
    return getDefault();
  }
}

function readPluginSizes(original: PluginDataMixin): SavedIconSize[] {
  return readPluginData<SavedIconSize[]>(original, 'sizes', SIZES_SCHEMA_VERSION, () => []);
}

function savePluginSizes(original: PluginDataMixin, sizes: SavedIconSize[]) {
  const data = JSON.stringify({
    version: SIZES_SCHEMA_VERSION,
    data: sizes
  } satisfies PluginDataMeta<SavedIconSize[]>);
  original.setPluginData('sizes', data);
}

type PluginDataMeta<T> = {
  data: T;
  version: number;
}

type Icon = {
  original: FrameNode;
  generated: GeneratedIconSize[];
  missing: MissingIconSize[];
}

type SavedIconSize = {
  id: string;
  size: number;
  type: 'fixed' | 'cropped';
}

type MissingIconSize = {
  name: string;
  size: number;
  type: 'fixed' | 'cropped';
  export: boolean;
}

type GeneratedIconSize = MissingIconSize & {
  id: string;
  component: ComponentNode;
  updated: boolean;
}

function isMissingIconSize(size: AnyIconSize): size is MissingIconSize {
  return !('id' in size) || !('component' in size);
}

function isGeneratedIconSize(size: AnyIconSize): size is GeneratedIconSize {
  return 'id' in size && 'component' in size;
}

type AnyIconSize = GeneratedIconSize | MissingIconSize;

const notifyErrors = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    console.error(e);
    figma.notify(e instanceof Error ? e.message : String(e));
  }
}

type MakeMessage<TType extends string, TPayload = undefined> = {
  type: TType;
  payload: TPayload;
}

type CancelMessage = MakeMessage<'cancel'>;
type GenerateMessage = MakeMessage<'generate', {
  originalSize: number;
  additionalSizes: number[];
}>;
type Message = CancelMessage | GenerateMessage;

type MessageHandlers = {
  [TType in Message['type']]: (msg: Extract<Message, { type: TType }>) => void;
}

const messageHandlers = ({
  cancel: (_msg) => {
    figma.closePlugin();
  },
  generate: ({ payload: { originalSize, additionalSizes } }) => {
    const allSizes = [ originalSize, ...additionalSizes ].sort((a, b) => b - a);
    if (figma.currentPage.name !== 'Icons') {
      figma.notify('Please selected a page named "Icons" to use this plugin.');
      return;
    }

    const originalsFrame = findOrCreateFrame('Originals', figma.currentPage);
    if (!originalsFrame) {
      figma.notify('Please create a frame named "Originals" to use this plugin.');
      return;
    }

    if (!originalsFrame.children.length) {
      figma.notify('Please add icons to the Originals frame.');
      return;
    }

    let originalIconFrames = originalsFrame.children.filter(isFrameNode);
    if (originalIconFrames.length !== originalsFrame.children.length) {
      figma.notify('All originals must be in frame.');
      return;
    }

    originalIconFrames = originalIconFrames.filter(icon => icon.width === originalSize && icon.height === originalSize && icon.layoutMode === 'NONE');
    if (originalIconFrames.length !== originalsFrame.children.length) {
      figma.notify(`All originals must be in fixed size of ${originalSize}px by ${originalSize}px.`);
      return;
    }

    layoutIcons(originalsFrame, originalSize, COLUMNS);

    // Frame to hold all generated frames
    const generatedFrame = findOrCreateFrame(`Generated`, figma.currentPage, frame => {
      frame.layoutPositioning = 'AUTO';
      frame.layoutMode = 'VERTICAL';
      frame.layoutSizingHorizontal = 'HUG';
      frame.layoutSizingVertical = 'HUG';
      frame.itemSpacing = 50;
      frame.counterAxisSpacing = 50;
      frame.fills = [];
      frame.expanded = true;
    });

    // For each original icon...
    const icons = originalIconFrames.map((original): Icon => {
      // Generated wanted sizes
      let wantedSizes = allSizes.reduce((all, size) => {
        all.push({
          name: `fixed_${size}px/${original.name}`,
          size,
          type: 'fixed',
          export: false
        });
        all.push({
          name: `cropped_${size}px/${original.name}`,
          size,
          type: 'cropped',
          export: size === original.width,
        });
        return all;
      }, [] as AnyIconSize[]);

      // Load saved sizes from plugin data
      const savedSizes = readPluginSizes(original);

      // Mark those that are already generated
      wantedSizes = wantedSizes.map(size => {
        const saved = savedSizes.find(s => s.size === size.size && s.type === size.type);
        if (saved) {
          const component = findComponentById(saved.id, generatedFrame);
          if (component) {
            return {
              ...size,
              id: saved.id,
              component,
              updated: false
            } satisfies GeneratedIconSize;
          } else {
            console.warn(`Component with id ${saved.id} (${size.name}) not found in generated frame.`);
          }
        }

        return size;
      });

      return {
        original,
        generated: wantedSizes.filter(isGeneratedIconSize),
        missing: wantedSizes.filter(isMissingIconSize),
      }
    });

    for (const icon of icons) {
      if (icon.missing.length === 0) {
        continue;
      }

      let missing: MissingIconSize | undefined;
      console.log(`Generating ${icon.missing.length} missing sizes for ${icon.original.name}`);

      // Generate missing sizes
      while ((missing = icon.missing.pop())) {
        // Where to put the generated size
        const parent = findOrCreateGeneratedSizeTypeFrame(missing, generatedFrame);
        // Generate the size
        const size = generateIconSize(icon.original, missing, parent);
        console.log(`- Generated ${missing.name}`);
        // Ready for export
        if (missing.export) {
          size.exportSettings = [
            {
              format: 'SVG',
            }
          ];
        } else {
          size.exportSettings = [];
        }
        // Mark as already updated
        icon.generated.push({
          ...missing,
          id: size.id,
          component: size,
          updated: true
        } satisfies GeneratedIconSize);
      }

      // Sort the generated sizes - fixed first, then by largest to smallest
      icon.generated.sort((a, b) => {
        if (a.type === b.type) {
          return b.size - a.size;
        }
        return (b.type === 'fixed' ? 1 : 0) - (a.type === 'fixed' ? 1 : 0);
      });
    }

    const framesToResize = new Set<FrameNode>();
    for (const icon of icons) {
      // Update previously generated sizes
      icon.generated = icon.generated.map(size => {
        framesToResize.add(size.component.parent as FrameNode);

        if (size.updated) {
          return size;
        }

        // Update
        console.log(`Updating ${size.name}`)
        updateIcon(icon.original, size);

        return size;
      });

      // Save the generated sizes to the original icon
      const savedSizes = icon.generated.map(size => ({
        id: size.component.id,
        size: size.size,
        type: size.type,
      } satisfies SavedIconSize));
      savePluginSizes(icon.original, savedSizes);
    }

    for (const frame of framesToResize) {
      layoutIcons(frame, originalSize, COLUMNS);
    }
  }
} satisfies MessageHandlers) as Record<string, (msg: { type: string, payload: unknown }) => void>;

figma.ui.onmessage = (msg: Message) => notifyErrors(() => {
  const handler = messageHandlers[msg.type];
  if (handler) {
    handler(msg);
  } else {
    console.error(`Unknown message type: ${msg.type}`);
    figma.notify(`Unknown message type: ${msg.type}`);
  }
});

figma.showUI(__html__);