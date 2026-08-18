"""打印 onnx 模型的输入/输出张量名与形状,供 docs 填实测参数。

用法: python3 scripts/inspect-onnx-io.py path/to/model.onnx
依赖: pip install onnx
"""
import sys
import onnx


def main() -> None:
    model = onnx.load(sys.argv[1])
    g = model.graph
    print("INPUTS:")
    for i in g.input:
        dims = [d.dim_value or d.dim_param for d in i.type.tensor_type.shape.dim]
        dtype = i.type.tensor_type.elem_type
        print(f"  {i.name}: dtype={dtype} dims={dims}")
    print("OUTPUTS:")
    for o in g.output:
        dims = [d.dim_value or d.dim_param for d in o.type.tensor_type.shape.dim]
        dtype = o.type.tensor_type.elem_type
        print(f"  {o.name}: dtype={dtype} dims={dims}")


if __name__ == "__main__":
    main()
