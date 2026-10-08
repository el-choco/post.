import {
  Group,
  Panel as ResizablePanel,
  Separator,
  useDefaultLayout,
} from "react-resizable-panels";
export function PanelGroup({ autoSaveId, direction, children }) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: autoSaveId,
    storage: localStorage,
  });
  return (
    <Group
      orientation={direction}
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      style={{ height: "100%", width: "100%" }}
    >
      {children}
    </Group>
  );
}
export function Panel({ defaultSize, minSize, maxSize, children, id }) {
  return (
    <ResizablePanel
      id={id}
      defaultSize={defaultSize === undefined ? undefined : `${defaultSize}%`}
      minSize={minSize === undefined ? undefined : `${minSize}%`}
      maxSize={maxSize === undefined ? undefined : `${maxSize}%`}
    >
      {children}
    </ResizablePanel>
  );
}
export const PanelResizeHandle = Separator;
