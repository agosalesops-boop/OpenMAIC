'use client';

/**
 * Lets the classroom page put extra controls (e.g. "Mark as complete") into
 * the course header's control cluster without threading props through
 * Stage → PlaybackChromeRoot → Header. Anywhere the provider isn't mounted
 * (workbench, edit chrome elsewhere), the slot is simply empty.
 */
import { createContext, useContext, type ReactNode } from 'react';

const ClassroomHeaderExtrasContext = createContext<ReactNode>(null);

export function ClassroomHeaderExtrasProvider({
  extras,
  children,
}: {
  extras: ReactNode;
  children: ReactNode;
}) {
  return (
    <ClassroomHeaderExtrasContext.Provider value={extras}>
      {children}
    </ClassroomHeaderExtrasContext.Provider>
  );
}

export function useClassroomHeaderExtras(): ReactNode {
  return useContext(ClassroomHeaderExtrasContext);
}
