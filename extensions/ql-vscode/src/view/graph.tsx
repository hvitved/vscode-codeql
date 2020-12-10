import * as React from 'react';
import { ResultTableProps } from './result-table-utils';
import { InterpretedResultSet, GraphInterpretationData } from '../pure/interface-types';
import { Graphviz } from 'graphviz-react';

export type GraphProps = ResultTableProps & { resultSet: InterpretedResultSet<GraphInterpretationData> };

export class Graph extends React.Component<GraphProps> {
  constructor(props: GraphProps) {
    super(props);
    this.state = { expanded: {}, selectedPathNode: undefined };
  }

  render(): JSX.Element {
    const options = {
      height: innerHeight,
      width: innerWidth,
      scale: 1,
      tweenPrecision: 1,
      engine: 'dot',
      keyMode: 'title',
      convertEqualSidedPolygons: false,
      fade: false,
      growEnteringEdges: false,
      fit: true,
      tweenPaths: false,
      tweenShapes: false,
      useWorker: false,
      zoom: true,
    };

   return <Graphviz
     dot={this.props.resultSet.interpretation.data.dot}
     options={options}
   />;
  }
}
